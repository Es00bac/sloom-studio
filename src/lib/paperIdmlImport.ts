import type { PaperDocument, PaperFrameKind, PaperTypography } from '../types/paper';
import {
  addFrameToPaperPage,
  addPaperPage,
  createDefaultPaperDocument,
  updatePaperDocumentSetup,
} from './paperDocument';
import { unzipBoundedZipSync } from './boundedZip';

/**
 * The importer deliberately accepts a small editable IDML subset rather than
 * silently flattening unfamiliar page items. Archive limits sit below the
 * generic OOXML limits because every retained part is parsed in memory.
 */
export const PAPER_IDML_ARCHIVE_LIMITS = {
  archiveLabel: 'IDML',
  maxEntries: 2_048,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
} as const;

/**
 * XML work limits are separate from ZIP expansion limits. A package can be small on disk yet hold an
 * adversarial XML part, so no parser is allowed to allocate or search through a 16 MiB entry merely
 * because the archive layer accepted it.
 */
export const PAPER_IDML_XML_LIMITS = {
  maxPartBytes: 2 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024,
  maxMimetypeBytes: 1_024,
  maxTagCharacters: 16 * 1024,
  maxTagsPerPart: 100_000,
  maxDepth: 64,
  maxAttributesPerTag: 128,
} as const;

const IDML_MIMETYPE = 'application/vnd.adobe.indesign-idml-package';
const PT_PER_MM = 72 / 25.4;
const MAX_PAGES = 200;
const MAX_FRAMES = 10_000;
const MAX_STORIES = 10_000;
const MAX_STORY_CHARACTERS = 64_000;
const MAX_DOCUMENT_CHARACTERS = 1_000_000;
const MAX_PAGE_SIZE_MM = 2_000;
const MATRIX_EPSILON = 0.001;

type XmlAttributes = Record<string, string>;

interface XmlElement {
  attributes: XmlAttributes;
  inner: string;
}

interface ScannedXmlElement {
  name: string;
  attributes: XmlAttributes;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  parentIndex: number | undefined;
  selfClosing: boolean;
}

interface IdmlColorTable {
  values: Map<string, string>;
  unsupported: Map<string, string>;
}

interface IdmlStory {
  self: string;
  text: string;
  typography: Partial<PaperTypography>;
}

interface IdmlPageGeometry {
  widthPt: number;
  heightPt: number;
  originXPt: number;
  originYPt: number;
}

interface ImportedFrame {
  kind: PaperFrameKind;
  label: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  text?: string;
  typography?: Partial<PaperTypography>;
  fillColor: string;
  strokeColor: string;
  strokeWidthMm: number;
  vertices?: Array<{ xPercent: number; yPercent: number }>;
}

interface ImportedPage {
  geometry: IdmlPageGeometry;
  frames: ImportedFrame[];
}

/**
 * Parse a bounded, editable IDML subset: single-page spreads, unthreaded text
 * frames, and unlinked rectangle geometry. Unsupported constructs fail before
 * any Paper document is returned, which keeps a partial conversion from being
 * mistaken for a successful import.
 */
export function importPaperIdmlPackage(bytes: Uint8Array, fallbackTitle = 'Imported IDML'): PaperDocument {
  const archive = unzipBoundedZipSync(bytes, PAPER_IDML_ARCHIVE_LIMITS);
  const mimetype = readRequiredXmlText(archive, 'mimetype', PAPER_IDML_XML_LIMITS.maxMimetypeBytes);
  if (mimetype.trim() !== IDML_MIMETYPE) {
    fail('archive mimetype is not an Adobe IDML package');
  }

  const designmap = readRequiredXmlText(archive, 'designmap.xml');
  assertSafeXml(designmap, 'designmap.xml');
  const preferences = readRequiredXmlText(archive, 'Resources/Preferences.xml');
  assertSafeXml(preferences, 'Resources/Preferences.xml');

  assertNoUnsupportedMasterSpreads(designmap);
  const acceptedLayer = assertSupportedDocumentLayers(designmap);

  const spreadPaths = collectPackageReferences(designmap, 'Spread', 'Spreads');
  if (spreadPaths.length === 0) fail('design map does not declare a spread');
  if (spreadPaths.length > MAX_PAGES) fail(`package exceeds ${MAX_PAGES} pages`);

  const storyPaths = collectPackageReferences(designmap, 'Story', 'Stories');
  if (storyPaths.length > MAX_STORIES) fail(`package exceeds ${MAX_STORIES} stories`);
  const stories = parseReferencedStories(archive, storyPaths);
  const colors = parseColorTable(archive);
  const defaultGeometry = parseDocumentPreference(preferences);

  const pages: ImportedPage[] = [];
  let totalFrames = 0;
  let totalCharacters = 0;
  const usedStories = new Set<string>();
  for (const path of spreadPaths) {
    const spread = readRequiredXmlText(archive, path);
    assertSafeXml(spread, path);
    assertSupportedSpreadObjects(spread, path);
    const page = parseSpreadPage(spread, path, defaultGeometry, stories, colors, usedStories, acceptedLayer);
    totalFrames += page.frames.length;
    totalCharacters += page.frames.reduce((sum, frame) => sum + (frame.text?.length ?? 0), 0);
    if (totalFrames > MAX_FRAMES) fail(`package exceeds ${MAX_FRAMES} frames`);
    if (totalCharacters > MAX_DOCUMENT_CHARACTERS) {
      fail(`package exceeds ${MAX_DOCUMENT_CHARACTERS} text characters`);
    }
    pages.push(page);
  }
  if (usedStories.size !== stories.size) {
    fail('design map declares a story that no supported text frame places');
  }

  const firstGeometry = pages[0]?.geometry;
  if (!firstGeometry) fail('package has no page geometry');
  for (const page of pages.slice(1)) {
    if (
      Math.abs(page.geometry.widthPt - firstGeometry.widthPt) > 0.01
      || Math.abs(page.geometry.heightPt - firstGeometry.heightPt) > 0.01
    ) {
      fail('mixed page sizes are not supported by this editable IDML subset');
    }
  }

  const title = readMetadataTitle(archive) ?? normalizeTitle(fallbackTitle);
  let document = createDefaultPaperDocument({ title, preset: 'custom' });
  document = updatePaperDocumentSetup(document, {
    preset: 'custom',
    widthMm: pointsToMm(firstGeometry.widthPt),
    heightMm: pointsToMm(firstGeometry.heightPt),
    bleedMm: 0,
  });
  document = { ...document, parentPages: [] };
  while (document.pages.length < pages.length) document = addPaperPage(document);

  for (const [pageIndex, importedPage] of pages.entries()) {
    const pageId = document.pages[pageIndex]?.id;
    if (!pageId) fail('internal page construction failed');
    for (const frame of importedPage.frames) {
      document = addFrameToPaperPage(document, pageId, {
        kind: frame.kind,
        label: frame.label,
        xMm: frame.xMm,
        yMm: frame.yMm,
        widthMm: frame.widthMm,
        heightMm: frame.heightMm,
        rotationDeg: frame.rotationDeg,
        text: frame.text,
        typography: frame.typography,
        fillColor: frame.fillColor,
        strokeColor: frame.strokeColor,
        strokeWidthMm: frame.strokeWidthMm,
        ...(frame.vertices ? { shapeKind: 'polygon' as const, vertices: frame.vertices } : {}),
      }).document;
    }
  }

  return { ...document, title, updatedAt: Date.now() };
}

function parseReferencedStories(archive: Record<string, Uint8Array>, storyPaths: readonly string[]): Map<string, IdmlStory> {
  const stories = new Map<string, IdmlStory>();
  for (const path of storyPaths) {
    const xml = readRequiredXmlText(archive, path);
    assertSafeXml(xml, path);
    const story = parseStory(xml, path);
    if (stories.has(story.self)) fail(`duplicate story identity "${story.self}"`);
    stories.set(story.self, story);
  }
  return stories;
}

function parseSpreadPage(
  xml: string,
  path: string,
  defaultGeometry: IdmlPageGeometry,
  stories: ReadonlyMap<string, IdmlStory>,
  colors: IdmlColorTable,
  usedStories: Set<string>,
  acceptedLayer: string | undefined,
): ImportedPage {
  const pageElements = findStartTags(xml, 'Page');
  if (pageElements.length !== 1 || countStartTags(xml, 'Page') !== 1) {
    fail(`${path} must contain exactly one page; facing and multi-page spreads are unsupported`);
  }
  const page = parsePageGeometry(pageElements[0]!, defaultGeometry, path);
  if (pageElements[0]!.AppliedMaster && pageElements[0]!.AppliedMaster !== 'n') {
    fail(`${path} applies a master spread, which this editable subset cannot preserve`);
  }
  const frames = findFrameElements(xml, path).map((element) => {
    assertSupportedFrameLayer(element.attributes.ItemLayer, acceptedLayer, path);
    const geometry = parseFrameGeometry(element.inner, element.attributes, page, path);
    const fillColor = resolveColor(element.attributes.FillColor, colors, 'fill', path);
    const strokeColor = resolveColor(element.attributes.StrokeColor, colors, 'stroke', path);
    const strokeWidthMm = roundMm(pointsToMm(readFiniteAttribute(element.attributes, 'StrokeWeight', 0, 0, 144, path)));

    if (element.name === 'TextFrame') {
      assertSupportedTextFramePreferences(element.inner, element.attributes, path);
      const parentStory = requiredAttribute(element.attributes, 'ParentStory', `${path} text frame`);
      const story = stories.get(parentStory);
      if (!story) fail(`${path} text frame references a missing or undeclared story "${parentStory}"`);
      if (usedStories.has(parentStory)) {
        fail(`${path} uses threaded or duplicate story "${parentStory}", which is outside the supported subset`);
      }
      if (
        (element.attributes.PreviousTextFrame && element.attributes.PreviousTextFrame !== 'n')
        || (element.attributes.NextTextFrame && element.attributes.NextTextFrame !== 'n')
      ) {
        fail(`${path} contains threaded text frames, which are outside the supported subset`);
      }
      usedStories.add(parentStory);
      return {
        kind: 'text' as const,
        label: 'Imported IDML text',
        ...geometry,
        text: story.text,
        typography: story.typography,
        fillColor,
        strokeColor,
        strokeWidthMm,
      };
    }

    const contentType = element.attributes.ContentType ?? 'Unassigned';
    if (contentType !== 'Unassigned') {
      fail(`${path} contains a linked or placed graphic frame; import the asset separately before placing it`);
    }
    if (/<(?:Link|Image|PDF|EPS|Graphic)\b/i.test(element.inner)) {
      fail(`${path} rectangle contains an unsupported graphic reference`);
    }
    return {
      kind: 'shape' as const,
      label: 'Imported IDML rectangle',
      ...geometry,
      fillColor,
      strokeColor,
      strokeWidthMm,
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    };
  });
  return { geometry: page, frames };
}

function parsePageGeometry(attributes: XmlAttributes, fallback: IdmlPageGeometry, path: string): IdmlPageGeometry {
  const bounds = attributes.GeometricBounds
    ? parseNumberList(attributes.GeometricBounds, 4, `${path} page bounds`)
    : [0, 0, fallback.heightPt, fallback.widthPt];
  const [top, left, bottom, right] = bounds;
  const widthPt = right - left;
  const heightPt = bottom - top;
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    fail(`${path} page bounds are invalid`);
  }
  assertSupportedPageSize(widthPt, heightPt, path);
  const matrix = parseMatrix(attributes.ItemTransform ?? '1 0 0 1 0 0', `${path} page transform`);
  if (
    Math.abs(matrix[0] - 1) > MATRIX_EPSILON
    || Math.abs(matrix[1]) > MATRIX_EPSILON
    || Math.abs(matrix[2]) > MATRIX_EPSILON
    || Math.abs(matrix[3] - 1) > MATRIX_EPSILON
  ) {
    fail(`${path} uses a rotated, scaled, or skewed page transform that this subset cannot preserve`);
  }
  return {
    widthPt,
    heightPt,
    originXPt: matrix[4] + left,
    originYPt: matrix[5] + top,
  };
}

function parseFrameGeometry(
  inner: string,
  attributes: XmlAttributes,
  page: IdmlPageGeometry,
  path: string,
): Pick<ImportedFrame, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg'> {
  const pathGeometries = findElements(inner, 'PathGeometry');
  if (pathGeometries.length !== 1 || countStartTags(inner, 'PathGeometry') !== 1) {
    fail(`${path} frame has no single rectangular path geometry`);
  }
  const geometryPath = findElements(pathGeometries[0]!.inner, 'GeometryPathType');
  if (geometryPath.length !== 1) fail(`${path} frame has unsupported path geometry`);
  const points = findStartTags(geometryPath[0]!.inner, 'PathPointType').map((point) =>
    parseNumberList(requiredAttribute(point, 'Anchor', `${path} path point`), 2, `${path} path point anchor`));
  if (points.length !== 4) fail(`${path} frame must have exactly four rectangular path points`);

  const [topLeft, bottomLeft, bottomRight, topRight] = points;
  const widthVector = subtract(topRight!, topLeft!);
  const heightVector = subtract(bottomLeft!, topLeft!);
  const expectedBottomRight = add(topLeft!, add(widthVector, heightVector));
  if (!roughlyEqualPoint(expectedBottomRight, bottomRight!, 0.01)) {
    fail(`${path} frame path is not a rectangle`);
  }

  const matrix = parseMatrix(attributes.ItemTransform ?? '1 0 0 1 0 0', `${path} frame transform`);
  const transformedWidth = transformVector(widthVector, matrix);
  const transformedHeight = transformVector(heightVector, matrix);
  const widthPt = vectorLength(transformedWidth);
  const heightPt = vectorLength(transformedHeight);
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    fail(`${path} frame has an empty transform`);
  }
  const orthogonality = Math.abs(dot(transformedWidth, transformedHeight)) / (widthPt * heightPt);
  if (orthogonality > MATRIX_EPSILON) {
    fail(`${path} frame uses a skew transform that Paper cannot represent`);
  }
  if (cross(transformedWidth, transformedHeight) <= 0) {
    fail(`${path} frame uses a reflected transform that Paper cannot represent`);
  }

  const localCenter = multiply(add(topLeft!, bottomRight!), 0.5);
  const center = transformPoint(localCenter, matrix);
  const xPt = center[0] - page.originXPt - widthPt / 2;
  const yPt = center[1] - page.originYPt - heightPt / 2;
  if (xPt < -0.01 || yPt < -0.01 || xPt + widthPt > page.widthPt + 0.01 || yPt + heightPt > page.heightPt + 0.01) {
    fail(`${path} frame lies outside its declared page bounds`);
  }
  return {
    xMm: roundMm(pointsToMm(Math.max(0, xPt))),
    yMm: roundMm(pointsToMm(Math.max(0, yPt))),
    widthMm: roundMm(pointsToMm(widthPt)),
    heightMm: roundMm(pointsToMm(heightPt)),
    rotationDeg: roundDegrees((Math.atan2(transformedWidth[1], transformedWidth[0]) * 180) / Math.PI),
  };
}

function parseStory(xml: string, path: string): IdmlStory {
  assertNoUnsupportedStoryContent(xml, path);
  const storyElements = findElements(xml, 'Story', path);
  if (storyElements.length !== 1 || countStartTags(xml, 'Story', path) !== 1) {
    fail(`${path} must contain exactly one story`);
  }
  const story = storyElements[0]!;
  const self = requiredAttribute(story.attributes, 'Self', path);
  const paragraphs = findElements(story.inner, 'ParagraphStyleRange', path);
  if (countStartTags(story.inner, 'ParagraphStyleRange', path) !== paragraphs.length) {
    fail(`${path} has malformed paragraph ranges`);
  }
  if (paragraphs.length === 0 && /<Content\b/.test(story.inner)) {
    fail(`${path} has text outside a supported paragraph range`);
  }

  const text: string[] = [];
  let typography: Partial<PaperTypography> = {};
  for (const paragraph of paragraphs) {
    if (/<(?:Br|Tab|ForcedLineBreak|TextVariableInstance|Footnote|Endnote)\b/i.test(paragraph.inner)) {
      fail(`${path} contains unsupported inline text content`);
    }
    const characterRanges = findElements(paragraph.inner, 'CharacterStyleRange', path);
    if (characterRanges.length !== 1 || countStartTags(paragraph.inner, 'CharacterStyleRange', path) !== 1) {
      fail(`${path} uses mixed or malformed character styles, which are outside the plain-text subset`);
    }
    const content = findElements(characterRanges[0]!.inner, 'Content', path);
    if (
      countStartTags(characterRanges[0]!.inner, 'Content', path) !== content.length
      || countStartTags(paragraph.inner, 'Content', path) !== content.length
    ) {
      fail(`${path} has malformed text content`);
    }
    const paragraphText = content.map((entry) => decodePlainXmlText(entry.inner, `${path} text`)).join('');
    text.push(paragraphText);
    if (Object.keys(typography).length === 0) typography = parseStoryTypography(paragraph);
  }
  const joined = text.join('\n');
  if (joined.length > MAX_STORY_CHARACTERS) fail(`${path} exceeds ${MAX_STORY_CHARACTERS} text characters`);
  return { self, text: joined, typography };
}

function parseStoryTypography(paragraph: XmlElement): Partial<PaperTypography> {
  const typography: Partial<PaperTypography> = {};
  const justification = paragraph.attributes.Justification;
  if (justification === 'CenterAlign') typography.align = 'center';
  else if (justification === 'RightAlign' || justification === 'RightJustified') typography.align = 'right';
  else if (justification === 'LeftJustified' || justification === 'FullyJustified') typography.align = 'justify';
  else if (justification === 'LeftAlign') typography.align = 'left';

  const characterRanges = findElements(paragraph.inner, 'CharacterStyleRange', 'IDML paragraph');
  const first = characterRanges[0];
  if (!first) return typography;
  const pointSize = optionalFiniteAttribute(first.attributes, 'PointSize');
  if (pointSize !== undefined && pointSize >= 4 && pointSize <= 400) typography.fontSizePt = pointSize;
  const fontStyle = first.attributes.FontStyle?.toLowerCase();
  if (fontStyle?.includes('bold')) typography.fontWeight = '700';
  if (fontStyle?.includes('italic') || fontStyle?.includes('oblique')) typography.fontStyle = 'italic';
  const properties = findElements(first.inner, 'Properties', 'IDML character style')[0];
  const appliedFont = properties ? findElements(properties.inner, 'AppliedFont', 'IDML font properties')[0] : undefined;
  if (appliedFont) {
    const family = decodePlainXmlText(appliedFont.inner, 'IDML applied font').trim();
    if (family && family.length <= 160) typography.fontFamily = family;
  }
  return typography;
}

function parseColorTable(archive: Record<string, Uint8Array>): IdmlColorTable {
  const colors: IdmlColorTable = {
    values: new Map<string, string>([
      ['Color/Paper', 'transparent'],
      ['Swatch/None', 'transparent'],
    ]),
    unsupported: new Map<string, string>(),
  };
  const xml = readOptionalXmlText(archive, 'Resources/Graphic.xml');
  if (!xml) return colors;
  assertSafeXml(xml, 'Resources/Graphic.xml');
  for (const attributes of findStartTags(xml, 'Color', 'Resources/Graphic.xml')) {
    const self = attributes.Self;
    if (!self || self === 'Color/Paper' || self === 'Swatch/None') continue;
    if (self === 'Color/Black') {
      // `Color/Black` is InDesign's CMYK process swatch. Pretending it is Paper's old #111827
      // fallback silently changes the page; reject it until Paper has a retained CMYK swatch path.
      colors.unsupported.set(self, 'the Color/Black CMYK process swatch');
      continue;
    }
    if (attributes.Space !== 'RGB' || !attributes.ColorValue) {
      colors.unsupported.set(self, `${attributes.Space ?? 'non-RGB'} color data`);
      continue;
    }
    const channels = parseNumberList(attributes.ColorValue, 3, `color "${self}"`).map((channel) => Math.round(channel));
    if (channels.some((channel) => channel < 0 || channel > 255)) {
      colors.unsupported.set(self, 'out-of-range RGB color data');
      continue;
    }
    colors.values.set(self, `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`);
  }
  return colors;
}

function resolveColor(
  reference: string | undefined,
  colors: IdmlColorTable,
  role: string,
  path: string,
): string {
  if (!reference || reference === 'Swatch/None') return 'transparent';
  const unsupported = colors.unsupported.get(reference);
  if (unsupported) fail(`${path} uses unsupported ${role} color reference "${reference}" (${unsupported})`);
  const color = colors.values.get(reference);
  if (!color) fail(`${path} uses an unsupported ${role} color reference "${reference}"`);
  return color;
}

function parseDocumentPreference(xml: string): IdmlPageGeometry {
  const preferences = findStartTags(xml, 'DocumentPreference', 'Resources/Preferences.xml');
  if (preferences.length !== 1) fail('Resources/Preferences.xml must declare one document preference');
  const attributes = preferences[0]!;
  const widthPt = readFiniteAttribute(attributes, 'PageWidth', 0, 1, MAX_PAGE_SIZE_MM * PT_PER_MM, 'document preference');
  const heightPt = readFiniteAttribute(attributes, 'PageHeight', 0, 1, MAX_PAGE_SIZE_MM * PT_PER_MM, 'document preference');
  assertSupportedPageSize(widthPt, heightPt, 'document preference');
  return { widthPt, heightPt, originXPt: 0, originYPt: 0 };
}

function collectPackageReferences(xml: string, localName: string, directory: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const attributes of findStartTags(xml, localName, `design map ${localName} reference`, true)) {
    const src = requiredAttribute(attributes, 'src', `design map ${localName} reference`);
    const safe = validatePartPath(src, directory);
    if (seen.has(safe)) fail(`design map declares ${localName.toLowerCase()} "${safe}" more than once`);
    seen.add(safe);
    references.push(safe);
  }
  return references;
}

function validatePartPath(value: string, directory: string): string {
  if (!new RegExp(`^${directory}/[^/]+\\.xml$`).test(value)) {
    fail(`package reference "${value}" is outside the supported ${directory} directory`);
  }
  return value;
}

function assertNoUnsupportedMasterSpreads(xml: string): void {
  const masterSpreads = collectPackageReferences(xml, 'MasterSpread', 'MasterSpreads');
  if (masterSpreads.length > 0) {
    fail('design map declares master spreads, which this editable subset cannot preserve');
  }
}

function parseIdmlBoolean(value: string | undefined, fallback: boolean, context: string): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  fail(`${context} has invalid boolean value "${value}"`);
}

function assertSupportedDocumentLayers(xml: string): string | undefined {
  const layers = findStartTags(xml, 'Layer', 'designmap.xml');
  if (layers.length > 1) fail('design map declares multiple layers, which this editable subset cannot preserve');
  if (layers.length === 0) return undefined;
  for (const layer of layers) {
    if (!parseIdmlBoolean(layer.Visible, true, 'design map layer visibility')) {
      fail('design map contains a hidden layer, which this editable subset cannot preserve');
    }
    if (!parseIdmlBoolean(layer.Printable, true, 'design map layer printability')) {
      fail('design map contains a non-printing layer, which this editable subset cannot preserve');
    }
    if (parseIdmlBoolean(layer.Locked, false, 'design map layer lock')) {
      fail('design map contains a locked layer, which this editable subset cannot preserve');
    }
  }
  return requiredAttribute(layers[0]!, 'Self', 'design map layer');
}

function assertSupportedFrameLayer(reference: string | undefined, acceptedLayer: string | undefined, path: string): void {
  if (!reference) return;
  if (!acceptedLayer || reference !== acceptedLayer) {
    fail(`${path} references an undeclared or unsupported layer "${reference}"`);
  }
}

function assertSupportedSpreadObjects(xml: string, path: string): void {
  const unsupported = /<(?:Group|Oval|Polygon|GraphicLine|SplineItem|Button|PageItem|Media|Sound|Movie|EPSText|MultiStateObject|FormField|TextPath)\b/i.exec(xml)?.[0];
  if (unsupported) fail(`${path} contains unsupported object ${unsupported}`);
}

function assertNoUnsupportedStoryContent(xml: string, path: string): void {
  const unsupported = /<(?:Table|Cell|Footnote|Endnote|Note|TextVariable|Hyperlink|XMLElement|XMLAttribute|Index|CrossReference|Condition|PageNumber|TextPath)\b/i.exec(xml)?.[0];
  if (unsupported) fail(`${path} contains unsupported story content ${unsupported}`);
}

const TEXT_FRAME_PREFERENCE_ATTRIBUTES = new Set([
  'TextColumnCount',
  'TextColumnGutter',
  'TextColumnFixedWidth',
  'TextInset',
  'InsetSpacing',
  'VerticalJustification',
  'FirstBaselineOffset',
  'UseFixedColumnWidth',
]);

function assertSupportedTextFramePreferenceAttributes(attributes: XmlAttributes, path: string, context: string): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (!TEXT_FRAME_PREFERENCE_ATTRIBUTES.has(name)) {
      fail(`${path} uses unsupported text-frame preference "${name}" in ${context}`);
    }
    if (name === 'TextColumnCount') {
      if (!Number.isInteger(Number(value)) || Number(value) !== 1) {
        fail(`${path} uses text-frame columns, which this editable subset cannot preserve`);
      }
      continue;
    }
    if (name === 'TextColumnGutter') {
      if (!Number.isFinite(Number(value))) fail(`${path} has invalid text-frame column gutter`);
      continue; // A gutter has no visual effect when the accepted column count is one.
    }
    if (name === 'TextColumnFixedWidth') {
      if (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > MATRIX_EPSILON) {
        fail(`${path} uses a fixed text-frame column width, which this editable subset cannot preserve`);
      }
      continue;
    }
    if (name === 'TextInset' || name === 'InsetSpacing') {
      const insets = parseNumberList(value, 4, `${path} text-frame inset`);
      if (insets.some((inset) => Math.abs(inset) > MATRIX_EPSILON)) {
        fail(`${path} uses text-frame insets, which this editable subset cannot preserve`);
      }
      continue;
    }
    if (name === 'VerticalJustification') {
      if (value !== 'TopAlign') {
        fail(`${path} uses vertical text justification, which this editable subset cannot preserve`);
      }
      continue;
    }
    if (name === 'FirstBaselineOffset') {
      if (value !== 'AscentOffset') {
        fail(`${path} uses a non-default first-baseline offset, which this editable subset cannot preserve`);
      }
      continue;
    }
    if (name === 'UseFixedColumnWidth' && parseIdmlBoolean(value, false, `${path} text-frame preference`)) {
      fail(`${path} uses fixed text-frame columns, which this editable subset cannot preserve`);
    }
  }
}

function assertSupportedTextFramePreferences(inner: string, frameAttributes: XmlAttributes, path: string): void {
  const preferenceElements = findStartTags(inner, 'TextFramePreference', path);
  if (preferenceElements.length > 1) fail(`${path} declares multiple text-frame preferences`);
  const directPreferences: XmlAttributes = Object.create(null) as XmlAttributes;
  for (const [name, value] of Object.entries(frameAttributes)) {
    if (TEXT_FRAME_PREFERENCE_ATTRIBUTES.has(name)) directPreferences[name] = value;
  }
  if (Object.keys(directPreferences).length > 0) {
    assertSupportedTextFramePreferenceAttributes(directPreferences, path, 'TextFrame attributes');
  }
  if (preferenceElements[0]) {
    assertSupportedTextFramePreferenceAttributes(preferenceElements[0], path, 'TextFramePreference');
  }
}

function findFrameElements(xml: string, path: string): Array<{ name: 'TextFrame' | 'Rectangle'; attributes: XmlAttributes; inner: string }> {
  const scanned = scanXmlElements(xml, path);
  const candidateIndexes = new Set<number>();
  for (const [index, element] of scanned.entries()) {
    if (element.name === 'TextFrame' || element.name === 'Rectangle') candidateIndexes.add(index);
  }
  const hasFrameAncestor = (element: ScannedXmlElement): boolean => {
    let parentIndex = element.parentIndex;
    while (parentIndex !== undefined) {
      if (candidateIndexes.has(parentIndex)) return true;
      parentIndex = scanned[parentIndex]!.parentIndex;
    }
    return false;
  };
  const candidates = [...candidateIndexes].map((index) => scanned[index]!);
  if (candidates.some((element) => element.selfClosing || hasFrameAncestor(element))) {
    fail(`${path} contains malformed, self-closing, or nested frame elements`);
  }
  return candidates.map((element) => ({
    name: element.name as 'TextFrame' | 'Rectangle',
    attributes: element.attributes,
    inner: xml.slice(element.innerStart, element.innerEnd),
  }));
}

function findElements(xml: string, name: string, context = name): XmlElement[] {
  const scanned = scanXmlElements(xml, context);
  const matchingIndexes = new Set<number>();
  for (const [index, element] of scanned.entries()) {
    if (element.name === name && !element.selfClosing) matchingIndexes.add(index);
  }
  for (const index of matchingIndexes) {
    let parentIndex = scanned[index]!.parentIndex;
    while (parentIndex !== undefined) {
      if (matchingIndexes.has(parentIndex)) fail(`${context} contains nested ${name} elements`);
      parentIndex = scanned[parentIndex]!.parentIndex;
    }
  }
  return [...matchingIndexes].map((index) => {
    const element = scanned[index]!;
    return { attributes: element.attributes, inner: xml.slice(element.innerStart, element.innerEnd) };
  });
}

function findStartTags(xml: string, name: string, context = name, allowNamespace = false): XmlAttributes[] {
  return scanXmlElements(xml, context)
    .filter((element) => element.name === name || (allowNamespace && element.name.slice(element.name.lastIndexOf(':') + 1) === name))
    .map((element) => element.attributes);
}

function countStartTags(xml: string, name: string, context = name): number {
  return findStartTags(xml, name, context).length;
}

function scanXmlElements(xml: string, context: string): ScannedXmlElement[] {
  const elements: ScannedXmlElement[] = [];
  const openElements: number[] = [];
  let cursor = 0;
  let tagCount = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) fail(`${context} has an unterminated XML comment`);
      if (end + 3 - start > PAPER_IDML_XML_LIMITS.maxTagCharacters) {
        fail(`${context} has an XML comment exceeding ${PAPER_IDML_XML_LIMITS.maxTagCharacters} characters`);
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      cursor = findXmlProcessingInstructionEnd(xml, start, context) + 1;
      continue;
    }
    if (xml[start + 1] === '!') fail(`${context} contains an unsupported XML declaration`);

    const end = findXmlTagEnd(xml, start, context);
    if (xml[start + 1] === '/') {
      const closingName = xml.slice(start + 2, end).trim();
      if (!/^[A-Za-z_][\w:.-]*$/.test(closingName)) fail(`${context} has a malformed closing element tag`);
      const elementIndex = openElements.pop();
      if (elementIndex === undefined) fail(`${context} closes "${closingName}" without an opening element`);
      const element = elements[elementIndex]!;
      if (element.name !== closingName) {
        fail(`${context} closes "${closingName}" while "${element.name}" is still open`);
      }
      element.innerEnd = start;
      element.end = end + 1;
      cursor = end + 1;
      continue;
    }

    let raw = xml.slice(start + 1, end).trim();
    const selfClosing = raw.endsWith('/');
    if (selfClosing) raw = raw.slice(0, -1).trimEnd();
    const name = /^[A-Za-z_][\w:.-]*/.exec(raw)?.[0];
    if (!name) fail(`${context} has a malformed opening element tag`);
    const attributes = parseAttributes(raw.slice(name.length), `${context} ${name}`);
    tagCount += 1;
    if (tagCount > PAPER_IDML_XML_LIMITS.maxTagsPerPart) {
      fail(`${context} exceeds ${PAPER_IDML_XML_LIMITS.maxTagsPerPart} XML tags`);
    }
    const elementIndex = elements.length;
    elements.push({
      name,
      attributes,
      start,
      end: selfClosing ? end + 1 : -1,
      innerStart: end + 1,
      innerEnd: selfClosing ? end + 1 : -1,
      parentIndex: openElements[openElements.length - 1],
      selfClosing,
    });
    if (!selfClosing) {
      openElements.push(elementIndex);
      if (openElements.length > PAPER_IDML_XML_LIMITS.maxDepth) {
        fail(`${context} exceeds ${PAPER_IDML_XML_LIMITS.maxDepth} XML nesting levels`);
      }
    }
    cursor = end + 1;
  }

  if (openElements.length > 0) {
    const element = elements[openElements[openElements.length - 1]!]!;
    fail(`${context} leaves "${element.name}" unterminated`);
  }
  return elements;
}

function findXmlTagEnd(xml: string, start: number, context: string): number {
  let quote: '"' | "'" | undefined;
  for (let cursor = start + 1; cursor < xml.length; cursor += 1) {
    if (cursor - start > PAPER_IDML_XML_LIMITS.maxTagCharacters) {
      fail(`${context} has an XML tag exceeding ${PAPER_IDML_XML_LIMITS.maxTagCharacters} characters`);
    }
    const character = xml[cursor]!;
    if (quote) {
      if (character === '<') fail(`${context} has an invalid "<" inside an XML attribute`);
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '<') fail(`${context} has an invalid "<" inside an XML tag`);
    if (character === '>') return cursor;
  }
  fail(`${context} has an unterminated XML tag`);
}

function findXmlProcessingInstructionEnd(xml: string, start: number, context: string): number {
  for (let cursor = start + 2; cursor < xml.length; cursor += 1) {
    if (cursor - start > PAPER_IDML_XML_LIMITS.maxTagCharacters) {
      fail(`${context} has an XML processing instruction exceeding ${PAPER_IDML_XML_LIMITS.maxTagCharacters} characters`);
    }
    if (xml[cursor] === '?' && xml[cursor + 1] === '>') return cursor + 1;
  }
  fail(`${context} has an unterminated XML processing instruction`);
}

function parseAttributes(raw: string, context: string): XmlAttributes {
  const attributes: XmlAttributes = Object.create(null) as XmlAttributes;
  const expression = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(expression)) {
    if (Object.keys(attributes).length >= PAPER_IDML_XML_LIMITS.maxAttributesPerTag) {
      fail(`${context} exceeds ${PAPER_IDML_XML_LIMITS.maxAttributesPerTag} XML attributes`);
    }
    const name = match[1]!;
    if (Object.hasOwn(attributes, name)) fail(`${context} declares duplicate attribute "${name}"`);
    attributes[name] = decodeXml(match[2] ?? match[3] ?? '', `${context} attribute`);
  }
  const remainder = raw.replace(expression, '').replace(/[\s/]/g, '');
  if (remainder) fail(`${context} has malformed attributes`);
  return attributes;
}

function requiredAttribute(attributes: XmlAttributes, name: string, context: string): string {
  const value = attributes[name]?.trim();
  if (!value) fail(`${context} is missing ${name}`);
  return value;
}

function optionalFiniteAttribute(attributes: XmlAttributes, name: string): number | undefined {
  const value = attributes[name];
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readFiniteAttribute(
  attributes: XmlAttributes,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  context: string,
): number {
  const value = attributes[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    fail(`${context} has invalid ${name}`);
  }
  return number;
}

function parseMatrix(value: string, context: string): [number, number, number, number, number, number] {
  const values = parseNumberList(value, 6, context);
  return values as [number, number, number, number, number, number];
}

function parseNumberList(value: string, count: number, context: string): number[] {
  const values = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length !== count || values.some((number) => !Number.isFinite(number))) {
    fail(`${context} must contain ${count} finite numbers`);
  }
  return values;
}

function decodePlainXmlText(value: string, context: string): string {
  if (/<[^>]*>/.test(value)) fail(`${context} contains unsupported inline XML`);
  return decodeXml(value, context);
}

function decodeXml(value: string, context: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);)/i.test(value)) {
    fail(`${context} contains an unknown XML entity`);
  }
  const decoded = value.replace(/&([^;]+);/g, (_, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const hex = /^#x([0-9a-f]+)$/i.exec(entity)?.[1];
    const decimal = /^#(\d+)$/.exec(entity)?.[1];
    const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      fail(`${context} contains an invalid XML character reference`);
    }
    return String.fromCodePoint(codePoint);
  });
  return decoded;
}

function assertSafeXml(xml: string, context: string): void {
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    fail(`${context} contains an unsupported XML declaration or entity`);
  }
  // A code-unit loop is linear and avoids creating one iterator value per Unicode scalar on a large
  // (but still admitted) XML part. Valid surrogate pairs remain accepted; unpaired halves fail.
  for (let index = 0; index < xml.length; index += 1) {
    const codeUnit = xml.charCodeAt(index);
    const isAllowedControl = codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d;
    if (codeUnit < 0x20 && !isAllowedControl) {
      fail(`${context} contains invalid XML control characters`);
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = xml.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail(`${context} contains invalid XML control characters`);
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail(`${context} contains invalid XML control characters`);
    }
  }
}

function readRequiredXmlText(
  archive: Record<string, Uint8Array>,
  path: string,
  maximumBytes = PAPER_IDML_XML_LIMITS.maxPartBytes,
): string {
  const bytes = archive[path];
  if (!bytes) fail(`required package part "${path}" is missing`);
  if (bytes.byteLength > maximumBytes) {
    fail(`${path} exceeds ${maximumBytes} XML bytes`);
  }
  return decodeIdmlUtf8(bytes, path);
}

function readOptionalXmlText(
  archive: Record<string, Uint8Array>,
  path: string,
  maximumBytes = PAPER_IDML_XML_LIMITS.maxPartBytes,
): string | undefined {
  const bytes = archive[path];
  if (!bytes) return undefined;
  if (bytes.byteLength > maximumBytes) {
    fail(`${path} exceeds ${maximumBytes} XML bytes`);
  }
  return decodeIdmlUtf8(bytes, path);
}

/** Retained IDML parts are UTF-8 XML/text. Never replace malformed bytes with U+FFFD: that would
 * silently change the editable document before the guarded replacement transaction can refuse it. */
function decodeIdmlUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${path} contains invalid UTF-8 data`);
  }
}

function readMetadataTitle(archive: Record<string, Uint8Array>): string | undefined {
  const xml = readOptionalXmlText(archive, 'META-INF/metadata.xml', PAPER_IDML_XML_LIMITS.maxMetadataBytes);
  if (!xml) return undefined;
  assertSafeXml(xml, 'META-INF/metadata.xml');
  const title = findElements(xml, 'dc:title', 'META-INF/metadata.xml')[0];
  const entry = title ? findElements(title.inner, 'rdf:li', 'metadata title')[0] : undefined;
  if (!entry) return undefined;
  const normalized = decodePlainXmlText(entry.inner, 'metadata title').trim();
  return normalized ? normalizeTitle(normalized) : undefined;
}

function normalizeTitle(value: string): string {
  const withoutControls = [...value]
    .map((character) => (character.codePointAt(0) ?? 0) < 0x20 ? ' ' : character)
    .join('');
  const normalized = withoutControls.trim().replace(/\s+/g, ' ');
  return (normalized || 'Imported IDML').slice(0, 160);
}

function assertSupportedPageSize(widthPt: number, heightPt: number, context: string): void {
  const widthMm = pointsToMm(widthPt);
  const heightMm = pointsToMm(heightPt);
  if (widthMm < 10 || heightMm < 10 || widthMm > MAX_PAGE_SIZE_MM || heightMm > MAX_PAGE_SIZE_MM) {
    fail(`${context} has an unsupported page size`);
  }
}

function pointsToMm(value: number): number {
  return value / PT_PER_MM;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundDegrees(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  const signed = normalized > 180 ? normalized - 360 : normalized;
  return Math.round(signed * 1000) / 1000;
}

function add(left: number[], right: number[]): [number, number] {
  return [left[0]! + right[0]!, left[1]! + right[1]!];
}

function subtract(left: number[], right: number[]): [number, number] {
  return [left[0]! - right[0]!, left[1]! - right[1]!];
}

function multiply(value: number[], scalar: number): [number, number] {
  return [value[0]! * scalar, value[1]! * scalar];
}

function transformPoint(point: number[], matrix: readonly number[]): [number, number] {
  return [
    matrix[0]! * point[0]! + matrix[2]! * point[1]! + matrix[4]!,
    matrix[1]! * point[0]! + matrix[3]! * point[1]! + matrix[5]!,
  ];
}

function transformVector(vector: number[], matrix: readonly number[]): [number, number] {
  return [
    matrix[0]! * vector[0]! + matrix[2]! * vector[1]!,
    matrix[1]! * vector[0]! + matrix[3]! * vector[1]!,
  ];
}

function vectorLength(vector: number[]): number {
  return Math.hypot(vector[0]!, vector[1]!);
}

function dot(left: number[], right: number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]!;
}

function cross(left: number[], right: number[]): number {
  return left[0]! * right[1]! - left[1]! * right[0]!;
}

function roughlyEqualPoint(left: number[], right: number[], epsilon: number): boolean {
  return Math.abs(left[0]! - right[0]!) <= epsilon && Math.abs(left[1]! - right[1]!) <= epsilon;
}

function fail(message: string): never {
  throw new Error(`IDML import: ${message}.`);
}
