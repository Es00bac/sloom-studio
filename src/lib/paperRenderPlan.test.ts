import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  addFrameToPaperParentPage,
  assignPaperParentPage,
  createDefaultPaperDocument,
  updatePaperDocumentSetup,
} from './paperDocument';
import { compilePaperRenderPlan } from './paperRenderPlan';
import type { PaperSwatch } from './paperSwatches';
import type { PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperTextShaper } from './paperTextShaper';

const cmykSwatch: PaperSwatch = {
  id: 'exact-cmyk',
  name: 'Exact CMYK panel',
  type: 'process',
  model: 'cmyk',
  rgb: { r: 24, g: 44, b: 80 },
  cmyk: { c: 12, m: 34, y: 56, k: 78 },
};

const spotSwatch: PaperSwatch = {
  id: 'spot-red',
  name: 'PANTONE 185 C',
  type: 'spot',
  model: 'cmyk',
  rgb: { r: 228, g: 0, b: 43 },
  cmyk: { c: 0, m: 91, y: 76, k: 0 },
  spotName: 'PANTONE 185 C',
};

function fontRef(): BinaryAssetRef {
  const sha256 = 'a'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function managedFace(): PaperManagedFontFace {
  return {
    id: 'fixture-regular',
    familyId: 'fixture sans',
    familyName: 'Fixture Sans',
    postscriptName: 'FixtureSans-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x0, end: 0x10ffff }],
    format: 'truetype',
    fontAsset: fontRef(),
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function fixtureShaper(): PaperTextShaper {
  return {
    shape(request) {
      const glyphs = Array.from(request.text).map((character, index) => ({
        glyphId: character.codePointAt(0) ?? 1,
        cluster: index,
        xAdvance: request.direction === 'ttb' ? 0 : request.fontSizePt / 2,
        yAdvance: request.direction === 'ttb' ? -request.fontSizePt / 2 : 0,
        xOffset: 0,
        yOffset: 0,
      }));
      return {
        direction: request.direction,
        glyphs,
        advanceX: glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0),
        advanceY: glyphs.reduce((total, glyph) => total + glyph.yAdvance, 0),
      };
    },
    glyphPath: () => 'M 0 0 L 500 0 L 500 500 Z',
    destroy: () => undefined,
  };
}

function fixtureDocument() {
  return updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Render plan fixture' }), {
    bleedMm: 0,
    background: { type: 'solid', color: 'transparent' },
  });
}

describe('compilePaperRenderPlan', () => {
  it('carries canonical production-sheet geometry and native 100K crop marks', async () => {
    const document = updatePaperDocumentSetup(fixtureDocument(), {
      bleedMm: 3,
      printProduction: {
        marks: { cropMarks: true, slugAreaMm: 10 },
      },
    });

    const page = (await compilePaperRenderPlan(document)).pages[0];

    expect(page.printSheet?.cropMarks).toHaveLength(8);
    expect(page.printSheet?.slugBox?.heightPt).toBeCloseTo(10 * 72 / 25.4, 5);
    expect(page.productionMarks).toHaveLength(8);
    expect(page.productionMarks?.[0]).toMatchObject({
      kind: 'path',
      objectId: 'production:crop:top-left:horizontal',
      stroke: { kind: 'process-cmyk', c: 0, m: 0, y: 0, k: 1, tint: 1 },
      strokeWidthPt: 0.25,
    });
  });

  it('compiles registration targets and CMYK control patches as native production paths', async () => {
    const document = updatePaperDocumentSetup(fixtureDocument(), {
      bleedMm: 3,
      printProduction: {
        marks: { registrationMarks: true, colorBars: true, slugAreaMm: 10 },
        jobInfo: { jobName: 'Press proof' },
      },
    });

    const page = (await compilePaperRenderPlan(document)).pages[0];
    expect(page.printSheet?.registrationMarks).toHaveLength(4);
    expect(page.printSheet?.colorBars).toHaveLength(9);
    expect(page.productionMarks).toHaveLength(21);
    expect(page.productionMarks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectId: 'production:registration:top:circle',
        stroke: { kind: 'process-cmyk', c: 1, m: 1, y: 1, k: 1, tint: 1 },
        overprint: true,
      }),
      expect.objectContaining({
        objectId: 'production:color-bar:cyan',
        fill: { kind: 'process-cmyk', c: 1, m: 0, y: 0, k: 0, tint: 1 },
      }),
    ]));
  });

  it('preserves an authored CMYK frame fill as a native process paint', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage({ ...base, swatches: [cmykSwatch] }, pageId, {
      kind: 'panel',
      label: 'Exact panel',
      xMm: 12,
      yMm: 18,
      widthMm: 60,
      heightMm: 30,
      fillColor: '#182c50',
      fillSwatchId: cmykSwatch.id,
      strokeColor: 'transparent',
      strokeWidthMm: 0,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({
      kind: 'path',
      fill: { kind: 'process-cmyk', c: 0.12, m: 0.34, y: 0.56, k: 0.78, tint: 1 },
    });
  });

  it('preserves a named spot tint as a native half-strength separation paint', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage({ ...base, swatches: [spotSwatch] }, pageId, {
      kind: 'panel',
      label: 'Half tint spot panel',
      xMm: 12,
      yMm: 18,
      widthMm: 60,
      heightMm: 30,
      fillColor: '#f18389',
      fillSwatchId: spotSwatch.id,
      fillTintPercent: 50,
      strokeColor: 'transparent',
      strokeWidthMm: 0,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({
      kind: 'path',
      fill: { kind: 'spot', name: 'PANTONE 185 C', tint: 0.5 },
    });
  });

  it('records non-native effects as deliberate flatten groups', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'caption',
      label: 'Flattened effect',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'Shadowed caption',
      fillGradient: { type: 'linear', fromColor: '#ffffff', toColor: '#111827', angleDeg: 45 },
      textShadowColor: '#000000',
      textShadowBlurMm: 2,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({
      kind: 'flatten-group',
      reasonCodes: ['gradient', 'blurred-text-shadow'],
    });
  });

  it('does not let a negative text arc bypass deliberate flattening', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'caption',
      label: 'Negative arc',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'Arc up',
      textArcPercent: -30,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({ kind: 'flatten-group', reasonCodes: ['text-arc'] });
  });

  it('includes out-of-frame bubble tails in flatten-group bounds', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'speechBubble',
      label: 'Long-tail bubble',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 20,
      text: 'Hello',
      tailXPercent: 150,
      tailYPercent: 120,
      fillGradient: { type: 'linear', fromColor: '#ffffff', toColor: '#111827', angleDeg: 45 },
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({ kind: 'flatten-group', reasonCodes: ['gradient'] });
    if (!node || node.kind !== 'flatten-group') throw new Error('Expected a flatten group.');
    expect(node.boundsPt.width).toBeGreaterThan(40 * 72 / 25.4);
    expect(node.boundsPt.height).toBeGreaterThan(20 * 72 / 25.4);
  });

  it('keeps same-speaker bubble bridges as filled native paths', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const first = addFrameToPaperPage(base, pageId, {
      kind: 'speechBubble', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18,
      text: '', bubbleChainId: 'speaker', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge',
    });
    const second = addFrameToPaperPage(first.document, pageId, {
      kind: 'speechBubble', xMm: 60, yMm: 20, widthMm: 30, heightMm: 18,
      text: '', bubbleChainId: 'speaker', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge',
    });

    const plan = await compilePaperRenderPlan(second.document);
    const bridge = plan.pages[0].nodes.find((candidate) => candidate.objectId.startsWith('bubble-compound:speaker:'));

    expect(bridge).toMatchObject({ kind: 'path', fill: { kind: 'managed-rgb' }, stroke: { kind: 'managed-rgb' } });
    if (!bridge || bridge.kind !== 'path') throw new Error('Expected a bridge path.');
    expect(bridge.path).toMatch(/Z$/);
  });

  it('places a connector above preceding panel art and below both linked bubbles', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const panel = addFrameToPaperPage(base, pageId, {
      kind: 'panel', xMm: 0, yMm: 0, widthMm: 100, heightMm: 100,
    });
    const first = addFrameToPaperPage(panel.document, pageId, {
      kind: 'speechBubble', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18,
      text: 'First', bubbleChainId: 'speaker-stack', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge',
    });
    const second = addFrameToPaperPage(first.document, pageId, {
      kind: 'speechBubble', xMm: 60, yMm: 20, widthMm: 30, heightMm: 18,
      text: 'Second', bubbleChainId: 'speaker-stack', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge',
    });

    const plan = await compilePaperRenderPlan(second.document);
    const objectIds = plan.pages[0].nodes.map((candidate) => candidate.objectId);
    const connectorId = objectIds.find((objectId) => objectId.startsWith('bubble-compound:speaker-stack:')) ?? '';

    expect(objectIds.indexOf(panel.frameId)).toBeLessThan(objectIds.indexOf(connectorId));
    expect(objectIds.indexOf(connectorId)).toBeLessThan(objectIds.indexOf(first.frameId));
    expect(objectIds.indexOf(connectorId)).toBeLessThan(objectIds.indexOf(second.frameId));
  });

  it('normalizes curved bubble connectors to cubic native paths', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const first = addFrameToPaperPage(base, pageId, {
      kind: 'speechBubble', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18,
      text: '', bubbleChainId: 'tail-chain', bubbleChainOrder: 1, bubbleConnectorStyle: 'tail',
    });
    const second = addFrameToPaperPage(first.document, pageId, {
      kind: 'speechBubble', xMm: 60, yMm: 30, widthMm: 30, heightMm: 18,
      text: '', bubbleChainId: 'tail-chain', bubbleChainOrder: 2, bubbleConnectorStyle: 'tail',
    });

    const plan = await compilePaperRenderPlan(second.document);
    const tail = plan.pages[0].nodes.find((candidate) => candidate.objectId === `connector:${first.frameId}:${second.frameId}`);

    expect(tail).toMatchObject({ kind: 'path', stroke: { kind: 'managed-rgb' } });
    if (!tail || tail.kind !== 'path') throw new Error('Expected a tail path.');
    expect(tail.path).toContain(' C ');
    expect(tail.path).not.toContain(' Q ');
  });

  it('places inherited parent items below local page frames in the shared plan', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const parentId = base.parentPages[0].id;
    const parent = addFrameToPaperParentPage(base, parentId, {
      kind: 'panel', label: 'Parent panel', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
      fillColor: '#dbeafe', strokeColor: 'transparent', strokeWidthMm: 0,
    });
    const assigned = assignPaperParentPage(parent.document, pageId, parentId);
    const local = addFrameToPaperPage(assigned, pageId, {
      kind: 'panel', label: 'Local panel', xMm: 15, yMm: 15, widthMm: 40, heightMm: 20,
      fillColor: '#fee2e2', strokeColor: 'transparent', strokeWidthMm: 0,
    });

    const plan = await compilePaperRenderPlan(local.document);
    const objectIds = plan.pages[0].nodes.filter((node) => node.kind === 'path').map((node) => node.objectId);
    const inheritedId = `inherited-${parentId}-${parent.frameId}-${pageId}`;

    expect(objectIds.indexOf(inheritedId)).toBeGreaterThanOrEqual(0);
    expect(objectIds.indexOf(inheritedId)).toBeLessThan(objectIds.indexOf(local.frameId));
  });

  it('keeps managed image bytes as an asset reference with a deterministic clip and transform', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const asset = { id: `sha256:${'b'.repeat(64)}`, sha256: 'b'.repeat(64), mimeType: 'image/png', byteLength: 12 } as const;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'image', label: 'Managed panel', xMm: 12, yMm: 18, widthMm: 50, heightMm: 30,
      fillColor: 'transparent',
      asset: {
        label: 'Managed panel', kind: 'image', pixelWidth: 1200, pixelHeight: 800,
        locator: { kind: 'managed', ref: asset },
      },
      imageScale: 1.2,
      imageOffsetXPercent: 5,
      imageRotationDeg: -12,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const image = plan.pages[0].nodes.find((candidate) => candidate.kind === 'image' && candidate.objectId === added.frameId);

    expect(image).toMatchObject({ kind: 'image', asset, clipPath: expect.any(String) });
    if (!image || image.kind !== 'image') throw new Error('Expected a managed image node.');
    expect(image.transform).toHaveLength(6);
    expect(image.transform[1]).toBeLessThan(0);
  });

  it('marks every linked-document frame for deliberate flattening, including its placeholder state', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'document', label: 'External PDF placeholder', xMm: 12, yMm: 18, widthMm: 50, heightMm: 30,
    });

    const plan = await compilePaperRenderPlan(added.document);
    const node = plan.pages[0].nodes.find((candidate) => candidate.objectId === added.frameId);

    expect(node).toMatchObject({ kind: 'flatten-group', reasonCodes: ['document-frame'] });
  });

  it('uses the supplied paint resolver for gradient-background flatten evidence', async () => {
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Gradient background' }), {
      bleedMm: 0,
      background: { type: 'linear-gradient', color: '#ffffff', fromColor: '#ffffff', toColor: '#111827', angleDeg: 45 },
    });
    const customPaint = { kind: 'process-cmyk' as const, c: 0.1, m: 0.2, y: 0.3, k: 0.4, tint: 1 };

    const plan = await compilePaperRenderPlan(document, { resolvePaint: () => customPaint });
    const background = plan.pages[0].background;

    expect(background).toMatchObject({ kind: 'flatten-group', children: [{ kind: 'path', fill: customPaint }] });
  });

  it('places managed rich text once in page coordinates and keeps its spot paint named', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage({ ...base, swatches: [spotSwatch], importedFonts: [managedFace()] }, pageId, {
      kind: 'text',
      label: 'Managed spot type',
      xMm: 10,
      yMm: 20,
      widthMm: 50,
      heightMm: 20,
      text: 'Ink',
      fillColor: 'transparent',
      typography: {
        fontFamily: 'Fixture Sans',
        fontSizePt: 12,
        leadingPt: 14,
        fontWeight: '400',
        color: '#e4002b',
        colorSwatchId: spotSwatch.id,
      },
    });

    const plan = await compilePaperRenderPlan(added.document, { managedFontResolver: async () => fixtureShaper() });
    const node = plan.pages[0].nodes.find((candidate) => candidate.kind === 'text' && candidate.objectId === added.frameId);

    expect(node).toMatchObject({ kind: 'text', composed: { missingFaces: [] } });
    if (!node || node.kind !== 'text') throw new Error('Expected a native text node.');
    expect(node.composed.bounds.xPt).toBeCloseTo((10 + 2) * 72 / 25.4, 5);
    expect(node.composed.bounds.yPt).toBeCloseTo((20 + 2) * 72 / 25.4, 5);
    expect(node.paints.runs[0].fill).toEqual({
      kind: 'spot',
      name: 'PANTONE 185 C',
      alternate: { c: 0, m: 0.91, y: 0.76, k: 0 },
      tint: 1,
    });
  });

  it('retains run orientation and emphasis geometry in the native render plan', async () => {
    const base = fixtureDocument();
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage({ ...base, importedFonts: [managedFace()] }, pageId, {
      kind: 'text',
      label: 'Vertical managed type',
      xMm: 10,
      yMm: 20,
      widthMm: 40,
      heightMm: 60,
      text: 'ABCD花《《強》》無',
      richText: [{ runs: [
        { text: 'AB', textOrientation: 'mixed', emphasis: 'dot' },
        { text: 'CD', textOrientation: 'upright', emphasis: 'open-dot' },
        { text: '花' },
        { text: '《《強》》' },
        { text: '無', emphasis: 'none' },
      ] }],
      typography: {
        fontFamily: 'Fixture Sans',
        fontSizePt: 12,
        leadingPt: 14,
        fontWeight: '400',
        color: '#111827',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        emphasis: 'circle',
      },
    });

    const plan = await compilePaperRenderPlan(added.document, { managedFontResolver: async () => fixtureShaper() });
    const node = plan.pages[0].nodes.find((candidate) => candidate.kind === 'text' && candidate.objectId === added.frameId);

    expect(node).toMatchObject({ kind: 'text', composed: { writingMode: 'vertical-rl', missingFaces: [] } });
    if (!node || node.kind !== 'text') throw new Error('Expected a native text node.');
    const mixed = node.composed.lines.flatMap((line) => line.runs).find((run) => run.text === 'AB');
    const upright = node.composed.lines.flatMap((line) => line.runs).find((run) => run.text === 'CD');
    expect(mixed).toMatchObject({ glyphRotationDeg: 90 });
    expect(upright?.glyphRotationDeg).toBeUndefined();
    expect(node.composed.emphasisMarks?.map((mark) => mark.style)).toEqual([
      'dot', 'dot', 'open-dot', 'open-dot', 'circle', 'sesame',
    ]);
    expect(node.paints.emphasisMarks).toHaveLength(6);
  });
});
