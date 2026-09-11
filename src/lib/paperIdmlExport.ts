// Real Adobe IDML (InDesign Markup Language) export (docs/notes/834 + the IDML technical reference).
// Produces a genuine `.idml` ZIP package that opens in InDesign / Affinity Publisher — NOT the previous
// `sloom-idml.json` interchange (which was a lie: it doesn't open in either program).
//
// Ground truth used:
// - Package = ZIP with `mimetype` (STORED, first) + META-INF/container.xml + designmap.xml (the hub) +
//   Resources/{Graphic,Fonts,Styles,Preferences}.xml + Spreads/*, Stories/*, XML/*.
// - Every part EXCEPT designmap.xml is wrapped in an `idPkg:*` element in the packaging namespace.
// - Geometry: units are points (pt = mm·72/25.4); the spread origin is the CENTRE of the binding, so a
//   single non-facing page has its top-left at spread (0, -H/2). A page item's outline lives in
//   PathGeometry (a 4-point Bézier rectangle) in the item's OWN space; its `ItemTransform`
//   (a b c d tx ty) maps that space into spread space. We centre each item's local rect at its origin
//   and put the placement (incl. rotation) entirely in the transform — rotation-safe and matches the
//   TextFrame "origin at bbox centre" convention.
// - Cross-refs are by `Self` id (bare) or `Type/Name` path (styles/colors). Fonts and images are
//   LINKED, never embedded — so image frames export as placeholder graphic boxes (relink on open).
//
// Verification we can do here: valid ZIP, mimetype first+stored, every XML part well-formed (xmllint),
// correct namespaces/DOMVersion, geometry math. "Opens in InDesign/Affinity" is the owner's final check.

import { strToU8, zipSync } from 'fflate';
import type { PaperDocument, PaperFrame, PaperLayer, PaperPage } from '../types/paper';
import { normalizePaperLayers } from './paperLayers';
import { parseHexColor, resolveSwatchCssColor, type PaperCmyk, type PaperRgb } from './paperSwatches';
import { resolvePaperFramesTextTemplates } from './paperTextVariables';

const IDPKG_NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const MIMETYPE = 'application/vnd.adobe.indesign-idml-package';
const PT_PER_MM = 72 / 25.4;
/** Default DOM version to target. Core elements here are stable since 8.0, so this opens broadly; if a
 *  specific InDesign/Affinity build refuses it, this is the single knob to change. */
export const IDML_DOM_VERSION = '16.0';

export interface PaperIdmlExportOptions {
  domVersion?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Compact number for XML attributes (no exponential, no trailing zeros, no -0). */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function idPkgPart(tag: string, dom: string, inner: string): string {
  return `${xmlDecl}\n<idPkg:${tag} xmlns:idPkg="${IDPKG_NS}" DOMVersion="${dom}">\n${inner}\n</idPkg:${tag}>`;
}

function isTextFrame(frame: PaperFrame): boolean {
  return frame.kind === 'text' || frame.kind === 'caption' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
}

const JUSTIFICATION: Record<string, string> = {
  left: 'LeftAlign',
  center: 'CenterAlign',
  right: 'RightAlign',
  justify: 'LeftJustified',
};

function fontStyleName(weight: string, italic: boolean): string {
  const bold = weight === 'bold' || Number(weight) >= 600;
  if (bold && italic) return 'Bold Italic';
  if (bold) return 'Bold';
  if (italic) return 'Italic';
  return 'Regular';
}

interface IdFactory {
  next: (prefix: string) => string;
}
function makeIdFactory(): IdFactory {
  let counter = 0;
  return { next: (prefix: string) => `${prefix}${(counter += 1).toString(36)}` };
}

// --- Colour collection --------------------------------------------------------------------------

interface ColorTable {
  /** Graphic.xml <Color> entries for document (non built-in) colours. */
  entries: string[];
  /** Resolve a CSS color/'transparent' to an IDML color reference (built-in or generated). */
  ref: (css: string | undefined) => string;
}

/** Parse a hex or rgb()/rgba() CSS color to 0–255 RGB. */
function cssToRgb(css: string): PaperRgb | undefined {
  const hex = parseHexColor(css);
  if (hex) return hex;
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(css);
  if (!match) return undefined;
  return { r: Math.round(+match[1]), g: Math.round(+match[2]), b: Math.round(+match[3]) };
}

/**
 * Build the document colour table. CMYK is preserved natively: a frame colour that matches a document
 * swatch carrying CMYK ink values is emitted as `Space="CMYK"` with the real ink values (IDML carries
 * CMYK first-class), so palette/press colours survive the round-trip instead of degrading to RGB.
 */
function buildColorTable(ids: IdFactory, document: PaperDocument): ColorTable {
  const cache = new Map<string, string>();
  const entries: string[] = [];
  // css (as stored on frames) → CMYK ink values, for every swatch that carries CMYK.
  const cmykByCss = new Map<string, PaperCmyk>();
  for (const swatch of document.swatches ?? []) {
    if (swatch.cmyk) cmykByCss.set(resolveSwatchCssColor(swatch), swatch.cmyk);
  }

  const ref = (css: string | undefined): string => {
    if (!css || css === 'transparent' || css === 'none') return 'Swatch/None';
    const cached = cache.get(css);
    if (cached) return cached;
    const self = `Color/${ids.next('c')}`;
    const cmyk = cmykByCss.get(css);
    if (cmyk) {
      const name = `C=${cmyk.c} M=${cmyk.m} Y=${cmyk.y} K=${cmyk.k}`;
      entries.push(
        `    <Color Self="${self}" Model="Process" Space="CMYK" ColorValue="${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}" ` +
        `ColorOverride="Normal" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" ` +
        `Name="${esc(name)}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>`,
      );
    } else {
      const rgb = cssToRgb(css);
      if (!rgb) return 'Color/Black';
      const name = `R=${rgb.r} G=${rgb.g} B=${rgb.b}`;
      entries.push(
        `    <Color Self="${self}" Model="Process" Space="RGB" ColorValue="${rgb.r} ${rgb.g} ${rgb.b}" ` +
        `ColorOverride="Normal" AlternateColorSpace="RGB" AlternateColorValue="${rgb.r} ${rgb.g} ${rgb.b}" ` +
        `Name="${esc(name)}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>`,
      );
    }
    cache.set(css, self);
    return self;
  };
  return { entries, ref };
}

// --- Resource parts (mostly fixed defaults) -----------------------------------------------------

function graphicXml(dom: string, colorEntries: string[]): string {
  const inner = [
    '  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>',
    '  <Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>',
    '  <Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>',
    '  <Color Self="Color/Cyan" Model="Process" Space="CMYK" ColorValue="100 0 0 0" ColorOverride="Normal" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Cyan" ColorEditable="true" ColorRemovable="true" Visible="false" SwatchCreatorID="7937"/>',
    '  <Color Self="Color/Magenta" Model="Process" Space="CMYK" ColorValue="0 100 0 0" ColorOverride="Normal" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Magenta" ColorEditable="true" ColorRemovable="true" Visible="false" SwatchCreatorID="7937"/>',
    '  <Color Self="Color/Yellow" Model="Process" Space="CMYK" ColorValue="0 0 100 0" ColorOverride="Normal" AlternateColorSpace="NoAlternateColor" AlternateColorValue="" Name="Yellow" ColorEditable="true" ColorRemovable="true" Visible="false" SwatchCreatorID="7937"/>',
    ...colorEntries,
    '  <Ink Self="Ink/Process Cyan" Name="Process Cyan" Angle="75" ConvertToProcess="false" Frequency="70" NeutralDensity="0.61" PrintInk="true" TrapOrder="1" InkAlias="$ID/" AliasInkName="Process Cyan"/>',
    '  <Ink Self="Ink/Process Magenta" Name="Process Magenta" Angle="15" ConvertToProcess="false" Frequency="70" NeutralDensity="0.76" PrintInk="true" TrapOrder="2" InkAlias="$ID/" AliasInkName="Process Magenta"/>',
    '  <Ink Self="Ink/Process Yellow" Name="Process Yellow" Angle="0" ConvertToProcess="false" Frequency="70" NeutralDensity="0.16" PrintInk="true" TrapOrder="3" InkAlias="$ID/" AliasInkName="Process Yellow"/>',
    '  <Ink Self="Ink/Process Black" Name="Process Black" Angle="45" ConvertToProcess="false" Frequency="70" NeutralDensity="1.7" PrintInk="true" TrapOrder="4" InkAlias="$ID/" AliasInkName="Process Black"/>',
    '  <Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" SwatchColorGroupReference="u0"/>',
  ].join('\n');
  return idPkgPart('Graphic', dom, inner);
}

function fontsXml(dom: string, families: string[]): string {
  const familyEntries = (families.length ? families : ['Minion Pro']).map((family) => {
    const safe = esc(family);
    return [
      `  <FontFamily Self="fontfamily/${safe}" Name="${safe}">`,
      `    <Font Self="font/${safe}/Regular" FontFamily="${safe}" Name="${safe} Regular" PostScriptName="${safe}" Status="Installed" FontStyleName="Regular" FontType="OpenTypeCFF" WritingScript="0" FullName="${safe}" FullNameNative="${safe}" FontStyleNameNative="Regular" PlatformName="$ID/"/>`,
      '  </FontFamily>',
    ].join('\n');
  }).join('\n');
  const inner = `  <RootFontFamily>\n${familyEntries}\n  </RootFontFamily>`;
  return idPkgPart('Fonts', dom, inner);
}

function stylesXml(dom: string): string {
  const inner = [
    '  <RootCharacterStyleGroup Self="u_rcs">',
    '    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]" Imported="false"/>',
    '  </RootCharacterStyleGroup>',
    '  <RootParagraphStyleGroup Self="u_rps">',
    '    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" NextStyle="ParagraphStyle/$ID/[No paragraph style]"/>',
    '    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" NextStyle="ParagraphStyle/$ID/NormalParagraphStyle">',
    '      <Properties>',
    '        <BasedOn type="object">ParagraphStyle/$ID/[No paragraph style]</BasedOn>',
    '      </Properties>',
    '    </ParagraphStyle>',
    '  </RootParagraphStyleGroup>',
    '  <RootCellStyleGroup Self="u_rcls">',
    '    <CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]" Imported="false"/>',
    '  </RootCellStyleGroup>',
    '  <RootTableStyleGroup Self="u_rts">',
    '    <TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]" Imported="false"/>',
    '    <TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]" Imported="false"/>',
    '  </RootTableStyleGroup>',
    '  <RootObjectStyleGroup Self="u_ros">',
    '    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" Imported="false" AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]"/>',
    '    <ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" Imported="false"/>',
    '    <ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]" Imported="false"/>',
    '    <ObjectStyle Self="ObjectStyle/$ID/[Normal Grid]" Name="$ID/[Normal Grid]" Imported="false"/>',
    '  </RootObjectStyleGroup>',
    '  <TOCStyle Self="TOCStyle/$ID/DefaultTOCStyleName" Name="$ID/DefaultTOCStyleName"/>',
  ].join('\n');
  return idPkgPart('Styles', dom, inner);
}

function preferencesXml(dom: string, widthPt: number, heightPt: number, document: PaperDocument): string {
  const bleedPt = document.page.bleedMm * PT_PER_MM;
  const slugBottomPt = document.printProduction.marks.slugAreaMm * PT_PER_MM;
  const inner = [
    `  <DocumentPreference PageHeight="${num(heightPt)}" PageWidth="${num(widthPt)}" PagesPerDocument="1" FacingPages="false" DocumentBleedTopOffset="${num(bleedPt)}" DocumentBleedBottomOffset="${num(bleedPt)}" DocumentBleedInsideOrLeftOffset="${num(bleedPt)}" DocumentBleedOutsideOrRightOffset="${num(bleedPt)}" SlugTopOffset="0" SlugBottomOffset="${num(slugBottomPt)}" SlugInsideOrLeftOffset="0" SlugRightOrOutsideOffset="0" ColumnGuideLocked="false"/>`,
    '  <TransparencyPreference/>',
    '  <ViewPreference HorizontalMeasurementUnits="Points" VerticalMeasurementUnits="Points" RulerOrigin="PageOrigin"/>',
  ].join('\n');
  return idPkgPart('Preferences', dom, inner);
}

function containerXml(): string {
  return `${xmlDecl}
<Container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="designmap.xml" media-type="application/xml"/>
  </rootfiles>
</Container>`;
}

function metadataXml(document: PaperDocument): string {
  const { jobInfo, marks } = document.printProduction;
  return `${xmlDecl}
<Metadata xmlns="http://ns.adobe.com/AdobeInDesign/idml/1.0/metadata">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sloom="https://sloom.studio/ns/paper/1.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(document.title)}</rdf:li></rdf:Alt></dc:title>
      <sloom:JobName>${esc(jobInfo.jobName)}</sloom:JobName>
      <sloom:JobNumber>${esc(jobInfo.jobNumber)}</sloom:JobNumber>
      <sloom:Client>${esc(jobInfo.client)}</sloom:Client>
      <sloom:Author>${esc(jobInfo.author)}</sloom:Author>
      <sloom:Notes>${esc(jobInfo.notes)}</sloom:Notes>
      <sloom:CropMarks>${marks.cropMarks}</sloom:CropMarks>
      <sloom:RegistrationMarks>${marks.registrationMarks}</sloom:RegistrationMarks>
      <sloom:ColorBars>${marks.colorBars}</sloom:ColorBars>
      <sloom:SlugAreaMm>${num(marks.slugAreaMm)}</sloom:SlugAreaMm>
    </rdf:Description>
  </rdf:RDF>
</Metadata>`;
}

// --- Story + frame emission ---------------------------------------------------------------------

function storyXml(dom: string, storySelf: string, frame: PaperFrame, colors: ColorTable): string {
  const typo = frame.typography;
  const fill = colors.ref(typo.color);
  const font = esc(typo.fontFamily || 'Minion Pro');
  const style = fontStyleName(typo.fontWeight, typo.fontStyle === 'italic');
  const justification = JUSTIFICATION[typo.align] ?? 'LeftAlign';
  const paragraphs = (frame.text ?? '').split('\n');
  const ranges = (paragraphs.length ? paragraphs : ['']).map((para) => [
    `    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="${justification}">`,
    `      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="${num(typo.fontSizePt)}" FillColor="${fill}" FontStyle="${esc(style)}">`,
    '        <Properties>',
    `          <AppliedFont type="string">${font}</AppliedFont>`,
    `          <Leading type="unit">${num(typo.leadingPt || typo.fontSizePt * 1.2)}</Leading>`,
    '        </Properties>',
    `        <Content>${esc(para)}</Content>`,
    '      </CharacterStyleRange>',
    '    </ParagraphStyleRange>',
  ].join('\n')).join('\n');
  const inner = [
    `  <Story Self="${storySelf}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">`,
    `    <StoryPreference OpticalMarginAlignment="${typo.opticalMarginAlignment === true ? 'true' : 'false'}" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>`,
    '    <InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>',
    ranges,
    '  </Story>',
  ].join('\n');
  return idPkgPart('Story', dom, inner);
}

interface FramePlacement {
  itemTransform: string;
  pathGeometry: string;
}
function framePlacement(frame: PaperFrame, pageWidthPt: number, pageHeightPt: number): FramePlacement {
  const wPt = frame.widthMm * PT_PER_MM;
  const hPt = frame.heightMm * PT_PER_MM;
  const xPt = frame.xMm * PT_PER_MM;
  const yPt = frame.yMm * PT_PER_MM;
  // Spread space: the single page is centred on the binding spine (origin) in BOTH axes — page left at
  // x=-W/2, page top at y=-H/2. (InDesign/Scribus place a single-page spread centred on the spine; using
  // x=0 for the left edge shifts every frame right by half a page and drops right-side frames off-page.)
  const cx = -pageWidthPt / 2 + xPt + wPt / 2;
  const cy = -pageHeightPt / 2 + yPt + hPt / 2;
  const theta = (frame.rotationDeg || 0) * (Math.PI / 180);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const itemTransform = `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(cx)} ${num(cy)}`;
  const hw = wPt / 2;
  const hh = hPt / 2;
  // Order: TL, BL, BR, TR (y-down: -hh is top).
  const pts = [[-hw, -hh], [-hw, hh], [hw, hh], [hw, -hh]];
  const pathPoints = pts
    .map(([x, y]) => `            <PathPointType Anchor="${num(x)} ${num(y)}" LeftDirection="${num(x)} ${num(y)}" RightDirection="${num(x)} ${num(y)}"/>`)
    .join('\n');
  const pathGeometry = [
    '        <PathGeometry>',
    '          <GeometryPathType PathOpen="false">',
    '            <PathPointArray>',
    pathPoints,
    '            </PathPointArray>',
    '          </GeometryPathType>',
    '        </PathGeometry>',
  ].join('\n');
  return { itemTransform, pathGeometry };
}

function textFrameXml(frame: PaperFrame, storySelf: string, layerSelf: string, placement: FramePlacement, colors: ColorTable): string {
  const self = `tf${storySelf}`;
  const columns = Math.max(1, frame.columns || 1);
  // Caption / bubble frames have a visible box (fill + border); carry those into the IDML so the frame's
  // background survives, not just its text.
  const fill = colors.ref(frame.fillColor);
  const stroke = colors.ref(frame.strokeColor);
  const strokeWeight = num((frame.strokeWidthMm || 0) * PT_PER_MM);
  return [
    `    <TextFrame Self="${self}" ParentStory="${storySelf}" ContentType="TextType" ItemLayer="${layerSelf}" ` +
      `FillColor="${fill}" StrokeColor="${stroke}" StrokeWeight="${strokeWeight}" ` +
      `PreviousTextFrame="n" NextTextFrame="n" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" ItemTransform="${placement.itemTransform}">`,
    '      <Properties>',
    placement.pathGeometry,
    '      </Properties>',
    `      <TextFramePreference TextColumnCount="${columns}" TextColumnGutter="12"/>`,
    '    </TextFrame>',
  ].join('\n');
}

function rectangleXml(frame: PaperFrame, self: string, layerSelf: string, placement: FramePlacement, colors: ColorTable): string {
  const fill = colors.ref(frame.fillColor);
  const stroke = colors.ref(frame.strokeColor);
  const strokeWeight = num((frame.strokeWidthMm || 0) * PT_PER_MM);
  const contentType = frame.kind === 'image' || frame.kind === 'document' ? 'GraphicType' : 'Unassigned';
  return [
    `    <Rectangle Self="${self}" ContentType="${contentType}" ItemLayer="${layerSelf}" ` +
      `AppliedObjectStyle="ObjectStyle/$ID/[None]" FillColor="${fill}" StrokeColor="${stroke}" StrokeWeight="${strokeWeight}" ItemTransform="${placement.itemTransform}">`,
    '      <Properties>',
    placement.pathGeometry,
    '      </Properties>',
    '    </Rectangle>',
  ].join('\n');
}

interface SpreadResult {
  spreadSelf: string;
  spreadFile: string;
  xml: string;
  stories: { self: string; xml: string }[];
}

interface IdmlLayer {
  paperLayer: PaperLayer;
  self: string;
}

interface IdmlLayerCatalog {
  /** The Paper catalog's canonical back-to-front order, preserved in designmap.xml. */
  layers: IdmlLayer[];
  defaultLayerSelf: string;
  selfForFrame: (frame: Pick<PaperFrame, 'layerId'>) => string;
}

function buildIdmlLayerCatalog(document: Pick<PaperDocument, 'layers'>): IdmlLayerCatalog {
  const layers = normalizePaperLayers(document.layers).map((paperLayer, index) => ({
    paperLayer,
    // Keep the existing single-layer identifier stable while assigning package-local identities. Paper
    // layer ids are intentionally not copied into Self: imported/legacy ids are not constrained to IDML.
    self: `layer${index + 1}`,
  }));
  const selfByPaperLayerId = new Map(layers.map(({ paperLayer, self }) => [paperLayer.id, self]));
  const defaultLayerSelf = layers[0].self;
  return {
    layers,
    defaultLayerSelf,
    selfForFrame: (frame) => selfByPaperLayerId.get(frame.layerId ?? '') ?? defaultLayerSelf,
  };
}

function spreadXml(
  page: PaperPage,
  pageIndex: number,
  document: PaperDocument,
  dom: string,
  layerCatalog: IdmlLayerCatalog,
  colors: ColorTable,
  ids: IdFactory,
): SpreadResult {
  const widthPt = document.page.widthMm * PT_PER_MM;
  const heightPt = document.page.heightMm * PT_PER_MM;
  const spreadSelf = ids.next('spread');
  const pageSelf = ids.next('page');
  const stories: { self: string; xml: string }[] = [];
  const items: string[] = [];

  for (const frame of resolvePaperFramesTextTemplates(page.frames, document, page.pageNumber)) {
    const placement = framePlacement(frame, widthPt, heightPt);
    if (isTextFrame(frame)) {
      const storySelf = ids.next('story');
      stories.push({ self: storySelf, xml: storyXml(dom, storySelf, frame, colors) });
      items.push(textFrameXml(frame, storySelf, layerCatalog.selfForFrame(frame), placement, colors));
    } else {
      items.push(rectangleXml(frame, ids.next('rect'), layerCatalog.selfForFrame(frame), placement, colors));
    }
  }

  const inner = [
    `  <Spread Self="${spreadSelf}" FlattenerOverride="Default" ShowMasterItems="true" PageCount="1" BindingLocation="0" PageTransitionType="None" PageTransitionDirection="NotApplicable" PageTransitionDuration="Medium">`,
    '    <FlattenerPreference LineArtAndTextResolution="300" GradientAndMeshResolution="150" ClipComplexRegions="false" ConvertAllStrokesToOutlines="false" ConvertAllTextToOutlines="false"/>',
    `    <Page Self="${pageSelf}" Name="${pageIndex + 1}" AppliedMaster="n" GeometricBounds="0 0 ${num(heightPt)} ${num(widthPt)}" ItemTransform="1 0 0 1 ${num(-widthPt / 2)} ${num(-heightPt / 2)}">`,
    `      <MarginPreference ColumnCount="1" ColumnGutter="12" Top="0" Bottom="0" Left="0" Right="0" ColumnDirection="Horizontal"/>`,
    '    </Page>',
    items.join('\n'),
    '  </Spread>',
  ].filter((line) => line !== '').join('\n');

  return { spreadSelf, spreadFile: `Spreads/Spread_${spreadSelf}.xml`, xml: idPkgPart('Spread', dom, inner), stories };
}

// --- designmap.xml + assembly -------------------------------------------------------------------

function designmapXml(
  dom: string,
  layerCatalog: IdmlLayerCatalog,
  spreads: SpreadResult[],
  storyList: string[],
  firstPageRef: string,
): string {
  const spreadRefs = spreads.map((s) => `  <idPkg:Spread src="${s.spreadFile}"/>`).join('\n');
  const storyRefs = storyList.map((self) => `  <idPkg:Story src="Stories/Story_${self}.xml"/>`).join('\n');
  const layerEntries = layerCatalog.layers.map(({ paperLayer, self }) => (
    `  <Layer Self="${self}" Name="${esc(paperLayer.name)}" Visible="${paperLayer.visible}" `
    + `Locked="${paperLayer.locked}" IgnoreWrap="false" ShowGuides="true" LockGuides="false" `
    + `UI="true" Expendable="true" Printable="${paperLayer.printable}"/>`
  )).join('\n');
  const aid = `<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="${dom}(1)" ?>`;
  return [
    xmlDecl,
    aid,
    `<Document xmlns:idPkg="${IDPKG_NS}" DOMVersion="${dom}" Self="sloomdoc" StoryList="${storyList.join(' ')}" ` +
      `ZeroPoint="0 0" ActiveLayer="${layerCatalog.defaultLayerSelf}" CMYKProfile="$ID/" RGBProfile="$ID/" ` +
      `SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="ColorPolicyOff" CMYKPolicy="ColorPolicyOff">`,
    '  <Language Self="Language/$ID/English%3a USA" Name="$ID/English: USA" SingleQuotes="‘’" DoubleQuotes="“”" PrimaryLanguageName="$ID/English" SublanguageName="$ID/USA" Id="269" HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/>',
    '  <idPkg:Graphic src="Resources/Graphic.xml"/>',
    '  <idPkg:Fonts src="Resources/Fonts.xml"/>',
    '  <idPkg:Styles src="Resources/Styles.xml"/>',
    '  <idPkg:Preferences src="Resources/Preferences.xml"/>',
    '  <idPkg:Tags src="XML/Tags.xml"/>',
    spreadRefs,
    '  <idPkg:BackingStory src="XML/BackingStory.xml"/>',
    storyRefs,
    '  <idPkg:Mapping src="XML/Mapping.xml"/>',
    layerEntries,
    `  <Section Self="section1" Length="${spreads.length}" Name="" ContinueNumbering="false" IncludeSectionPrefix="false" Marker="" PageNumberStyle="Arabic" PageStart="${firstPageRef}" SectionPrefix="" AlternateLayoutLength="0"/>`,
    '  <ColorGroup Self="u0" Name="[Root Color Group]" IsRootColorGroup="true">',
    '    <ColorGroupSwatch Self="u0gs0" SwatchItemRef="Swatch/None"/>',
    '    <ColorGroupSwatch Self="u0gs1" SwatchItemRef="Color/Registration"/>',
    '    <ColorGroupSwatch Self="u0gs2" SwatchItemRef="Color/Paper"/>',
    '    <ColorGroupSwatch Self="u0gs3" SwatchItemRef="Color/Black"/>',
    '  </ColorGroup>',
    '</Document>',
  ].join('\n');
}

function backingStoryXml(dom: string): string {
  const inner = [
    '  <XmlStory Self="backingstory" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">',
    '    <StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>',
    '    <InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>',
    '    <XMLElement Self="di1" MarkupTag="XMLTag/Root"/>',
    '  </XmlStory>',
  ].join('\n');
  return idPkgPart('BackingStory', dom, inner);
}

function tagsXml(dom: string): string {
  return idPkgPart('Tags', dom, '  <XMLTag Self="XMLTag/Root" Name="Root">\n    <Properties>\n      <TagColor type="enumeration">LightBlue</TagColor>\n    </Properties>\n  </XMLTag>');
}

function mappingXml(dom: string): string {
  return idPkgPart('Mapping', dom, '  <XMLImportMaps/>');
}

/** Build the individual IDML package parts as path → text (mimetype included). For tests + xmllint. */
export function buildPaperIdmlParts(document: PaperDocument, options: PaperIdmlExportOptions = {}): Record<string, string> {
  const dom = options.domVersion ?? IDML_DOM_VERSION;
  const ids = makeIdFactory();
  const layerCatalog = buildIdmlLayerCatalog(document);
  const colors = buildColorTable(ids, document);
  const widthPt = document.page.widthMm * PT_PER_MM;
  const heightPt = document.page.heightMm * PT_PER_MM;

  const spreads: SpreadResult[] = document.pages.map((page, index) =>
    spreadXml(page, index, document, dom, layerCatalog, colors, ids));

  const storyList: string[] = [];
  const storyFiles: Record<string, string> = {};
  for (const spread of spreads) {
    for (const story of spread.stories) {
      storyList.push(story.self);
      storyFiles[`Stories/Story_${story.self}.xml`] = story.xml;
    }
  }

  const firstPageRef = 'section1';
  const parts: Record<string, string> = {
    mimetype: MIMETYPE,
    'META-INF/container.xml': containerXml(),
    'META-INF/metadata.xml': metadataXml(document),
    'designmap.xml': designmapXml(dom, layerCatalog, spreads, storyList, firstPageRef),
    'Resources/Graphic.xml': graphicXml(dom, colors.entries),
    'Resources/Fonts.xml': fontsXml(dom, collectFontFamilies(document)),
    'Resources/Styles.xml': stylesXml(dom),
    'Resources/Preferences.xml': preferencesXml(dom, widthPt, heightPt, document),
    'XML/BackingStory.xml': backingStoryXml(dom),
    'XML/Tags.xml': tagsXml(dom),
    'XML/Mapping.xml': mappingXml(dom),
  };
  for (const spread of spreads) parts[spread.spreadFile] = spread.xml;
  Object.assign(parts, storyFiles);
  return parts;
}

function collectFontFamilies(document: PaperDocument): string[] {
  const set = new Set<string>();
  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (isTextFrame(frame) && frame.typography.fontFamily) set.add(frame.typography.fontFamily);
    }
  }
  return [...set];
}

/** Build a complete `.idml` package (ZIP bytes). `mimetype` is stored first, uncompressed. */
export function buildPaperIdmlPackage(document: PaperDocument, options: PaperIdmlExportOptions = {}): Uint8Array {
  const parts = buildPaperIdmlParts(document, options);
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  // mimetype MUST be first and STORED (level 0).
  files.mimetype = [strToU8(parts.mimetype), { level: 0 }];
  for (const [path, text] of Object.entries(parts)) {
    if (path === 'mimetype') continue;
    files[path] = [strToU8(text), { level: 6 }];
  }
  return zipSync(files, {});
}
