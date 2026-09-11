import { describe, expect, it } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import {
  addFrameToPaperPage,
  addFrameToPaperParentPage,
  assignPaperParentPage,
  computeEffectivePaperFrame,
  createDefaultPaperDocument,
  DEFAULT_PAPER_TYPOGRAPHY,
  effectiveRtlBinding,
  detachInheritedPaperFrame,
  exportPaperDocumentToPrintHtml,
  parsePaperDocument,
  paperDocumentBackgroundCss,
  paperPixelsFromMm,
  PAPER_PAGE_PRESETS,
  PAPER_SAFE_SANS,
  placeSourceAssetInPaperFrame,
  resolvePaperFontFamily,
  resolvePaperFrameTextContentBoxMm,
  resolvePaperPageFramesForOutput,
  updatePaperDocumentSetup,
  updatePaperFrame,
} from './paperDocument';

describe('resolvePaperFontFamily (print-safe fonts)', () => {
  it('replaces the non-deterministic system-ui keyword with a concrete installed chain', () => {
    const resolved = resolvePaperFontFamily('Inter, system-ui, sans-serif');
    expect(resolved).not.toMatch(/system-ui/);
    expect(resolved).toContain('Liberation Sans');
    expect(resolved.endsWith('sans-serif')).toBe(true);
    // a real leading font is preserved (forward-compatible if Inter is ever installed/bundled)
    expect(resolved.startsWith('Inter,')).toBe(true);
  });

  it('leaves concrete font stacks and generics untouched', () => {
    expect(resolvePaperFontFamily('Georgia, "Times New Roman", serif')).toBe('Georgia, "Times New Roman", serif');
    expect(resolvePaperFontFamily('"Courier New", Courier, monospace')).toBe('"Courier New", Courier, monospace');
  });

  it('falls back to the safe sans stack for empty input', () => {
    expect(resolvePaperFontFamily(undefined)).toBe(PAPER_SAFE_SANS);
    expect(resolvePaperFontFamily('   ')).toBe(PAPER_SAFE_SANS);
  });
});

describe('Paper kerning export', () => {
  it('preserves the selected kerning mode in print HTML', () => {
    const document = createDefaultPaperDocument({ title: 'Kerning export' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      kind: 'text',
      xMm: 12,
      yMm: 12,
      widthMm: 80,
      heightMm: 30,
      text: 'AVATAR',
      typography: { ...DEFAULT_PAPER_TYPOGRAPHY, fontKerning: 'none' },
    });

    expect(exportPaperDocumentToPrintHtml(added.document)).toContain('font-kerning: none');
  });
});

describe('resolvePaperFrameTextContentBoxMm', () => {
  it('uses the same physical inset as print HTML for ordinary text frames', () => {
    let document = createDefaultPaperDocument({ title: 'Managed text geometry' });
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 60,
      heightMm: 30,
    });
    document = added.document;
    expect(resolvePaperFrameTextContentBoxMm(document.pages[0].frames[0])).toEqual({
      xMm: 2,
      yMm: 2,
      widthMm: 56,
      heightMm: 26,
    });
  });

  it('keeps all rich paragraph callout boxes flush with the frame like the editor preview', () => {
    let document = createDefaultPaperDocument({ title: 'Managed paragraph box geometry' });
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 60,
      heightMm: 30,
      richText: [{ runs: [{ text: 'Boxed text' }], shading: '#e5e7eb' }],
    });
    document = added.document;

    expect(resolvePaperFrameTextContentBoxMm(document.pages[0].frames[0])).toEqual({
      xMm: 0,
      yMm: 0,
      widthMm: 60,
      heightMm: 30,
    });
  });
});

function makeImageItem(): SourceBinLibraryItem {
  return {
    id: 'asset-panel-1',
    label: 'Panel Art',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: 'data:image/png;base64,abc123',
    createdAt: 1,
  };
}

describe('paperDocument', () => {
  it('creates a print-oriented document with pages, margins, grids, and guides enabled', () => {
    const doc = createDefaultPaperDocument({
      title: 'Sloom Studio Comic',
      preset: 'us-letter',
    });

    expect(doc.title).toBe('Sloom Studio Comic');
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].pageNumber).toBe(1);
    expect(doc.page.widthMm).toBe(215.9);
    expect(doc.page.heightMm).toBe(279.4);
    expect(doc.page.dpi).toBe(300);
    expect(doc.layout.marginsMm.top).toBeGreaterThan(0);
    expect(doc.layout.columns.count).toBe(2);
    expect(doc.view.showRulers).toBe(true);
    expect(doc.view.showGrid).toBe(true);
    expect(doc.view.showGuides).toBe(true);
    expect(doc.view.showFrameEdges).toBe(false);
    expect(doc.view.snapToGuides).toBe(false);
    expect(doc.view.snapToGrid).toBe(false);
    expect(doc.printProduction).toEqual(expect.objectContaining({
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'srgb',
      totalInkLimitPercent: 300,
    }));
    expect(doc.parentPages).toHaveLength(1);
    expect(doc.styles.paragraph.map((style) => style.id)).toEqual(expect.arrayContaining(['para-comic-dialogue', 'para-caption', 'para-sfx']));
  });

  it('creates new text frames borderless (Word-like) but keeps comic bubbles filled/stroked', () => {
    let doc = createDefaultPaperDocument({ title: 'Borderless defaults' });
    const pageId = doc.pages[0].id;

    // A plain text frame with no explicit stroke/fill = a document paragraph: no border, no fill.
    const text = addFrameToPaperPage(doc, pageId, { kind: 'text', xMm: 20, yMm: 20, widthMm: 60, heightMm: 20 });
    doc = text.document;
    const textFrame = doc.pages[0].frames.find((f) => f.id === text.frameId)!;
    expect(textFrame.strokeWidthMm).toBe(0);
    expect(textFrame.strokeColor).toBe('transparent');
    expect(textFrame.fillColor).toBe('transparent');

    // A speech bubble must still get its white fill + visible stroke (comic workflow unchanged).
    const bubble = addFrameToPaperPage(doc, pageId, { kind: 'speechBubble', xMm: 20, yMm: 50, widthMm: 60, heightMm: 30 });
    doc = bubble.document;
    const bubbleFrame = doc.pages[0].frames.find((f) => f.id === bubble.frameId)!;
    expect(bubbleFrame.fillColor).toBe('#ffffff');
    expect(bubbleFrame.strokeWidthMm).toBeGreaterThan(0);
  });

  it('normalizes legacy speech/thought frame kinds into current bubble frame kinds', () => {
    const legacy = {
      ...createDefaultPaperDocument({ title: 'Legacy bubbles' }),
      pages: [
        {
          ...createDefaultPaperDocument().pages[0],
          frames: [
            {
              id: 'legacy-speech',
              kind: 'speech',
              xMm: 10,
              yMm: 12,
              widthMm: 50,
              heightMm: 24,
              text: 'Speech alias',
            },
            {
              id: 'legacy-thought',
              kind: 'thought',
              xMm: 20,
              yMm: 40,
              widthMm: 50,
              heightMm: 24,
              text: 'Thought alias',
            },
          ],
        },
      ],
    };

    const parsed = parsePaperDocument(JSON.stringify(legacy));

    expect(parsed.pages[0].frames.map((frame) => frame.kind)).toEqual(['speechBubble', 'thoughtBubble']);
    expect(exportPaperDocumentToPrintHtml(parsed)).toContain('class="frame frame-speechBubble"');
    expect(exportPaperDocumentToPrintHtml(parsed)).toContain('class="frame frame-thoughtBubble"');
  });

  it('migrates legacy documents and stale frame assignments onto a valid default layer', () => {
    let legacy = createDefaultPaperDocument({ title: 'Legacy layer migration' });
    legacy = addFrameToPaperPage(legacy, legacy.pages[0].id, {
      id: 'legacy-copy', kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
    }).document;
    const raw = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    delete raw.layers;
    const rawPages = raw.pages as Array<{ frames: Array<Record<string, unknown>> }>;
    delete rawPages[0].frames[0].layerId;

    const migrated = parsePaperDocument(JSON.stringify(raw));
    expect(migrated.layers).toEqual([expect.objectContaining({
      id: 'paper-layer-default', visible: true, printable: true, locked: false,
    })]);
    expect(migrated.pages[0].frames[0].layerId).toBe(migrated.layers[0].id);

    raw.layers = [{ id: 'art', name: 'Artwork', visible: true, printable: true, locked: false }];
    rawPages[0].frames[0].layerId = 'missing-layer';
    const repaired = parsePaperDocument(JSON.stringify(raw));
    expect(repaired.pages[0].frames[0].layerId).toBe('art');
  });

  it('round-trips every authored bubble geometry and effect control through Paper normalization', () => {
    let document = createDefaultPaperDocument({ title: 'Asymmetric bubble geometry' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'asymmetric-bubble',
      kind: 'speechBubble',
      xMm: 11.125,
      yMm: 22.25,
      widthMm: 77.5,
      heightMm: 44.75,
      rotationDeg: 13.5,
      fit: 'stretch',
      imageScale: 1.23,
      imageOffsetXPercent: 17,
      imageOffsetYPercent: -19,
      imageRotationDeg: 23,
      imageFlipX: true,
      imageFlipY: true,
      columns: 3,
      columnGutterMm: 6.5,
      columnRule: true,
      columnBalance: true,
      threadId: 'story-geometry',
      threadOrder: 7,
      typography: {
        fontFamily: 'Georgia, serif',
        fontSizePt: 17,
        leadingPt: 21,
        tracking: 45,
        fontKerning: 'none',
        align: 'justify',
        hyphenate: false,
        color: '#123456',
        fontWeight: '600',
        fontStyle: 'italic',
        firstLineIndentMm: 4.25,
        alignLast: 'center',
        smallCaps: true,
        numericStyle: 'tabular',
        dropCapLines: 3,
        spaceBeforeMm: 1.5,
        spaceAfterMm: 2.5,
        lineBreak: 'pretty',
      },
      fillColor: '#abcdef',
      fillTintPercent: 73,
      fillOpacity: 0.81,
      fillGradient: { type: 'linear', fromColor: '#010203', toColor: '#fefdfc', angleDeg: 137 },
      strokeColor: '#654321',
      strokeTintPercent: 63,
      strokeOpacity: 0.72,
      strokeWidthMm: 0.87,
      strokeStyle: 'double',
      cornerRadiusMm: 8.5,
      opacity: 0.91,
      textBoxXPercent: 11,
      textBoxYPercent: 12,
      textBoxWidthPercent: 73,
      textBoxHeightPercent: 64,
      textRotationDeg: 9,
      textVerticalAlign: 'bottom',
      textStrokeColor: '#aabbcc',
      textStrokeWidthMm: 0.42,
      textShadowColor: '#223344',
      textShadowOffsetXMm: 1.25,
      textShadowOffsetYMm: -1.5,
      textShadowBlurMm: 2.75,
      textSkewXDeg: 3.5,
      textSkewYDeg: -4.5,
      textScaleX: 1.14,
      textScaleY: 0.86,
      textArcPercent: 28,
      bubbleShape: 'squircle',
      bubbleWarp: 0.17,
      bubbleWarpLeft: 0.5,
      bubbleWarpRight: -0.2,
      bubbleWarpTop: 0.4,
      bubbleWarpBottom: -0.3,
      bubblePinchXPercent: 61,
      bubblePinchYPercent: 76,
      bubbleTailWidthPercent: 19,
      bubbleTailCurvePercent: 57,
      bubbleChainId: 'chain-geometry',
      bubbleChainOrder: 4,
      bubbleConnectorStyle: 'bridge',
      bubbleConnectorAnchor: 'top',
      bubbleConnectorGeometry: {
        fromAngleDeg: 42,
        toAngleDeg: 221,
        control1AlongPercent: 25,
        control1OffsetPercent: -13,
        control2AlongPercent: 72,
        control2OffsetPercent: 18,
        widthMm: 3.25,
        taperPercent: 44,
      },
      tailXPercent: 71,
      tailYPercent: 94,
      zIndex: 9,
    }).document;

    const parsed = parsePaperDocument(JSON.stringify(document));
    const frame = parsed.pages[0].frames.find((candidate) => candidate.id === 'asymmetric-bubble');

    expect(frame).toEqual(expect.objectContaining({
      xMm: 11.125,
      yMm: 22.25,
      widthMm: 77.5,
      heightMm: 44.75,
      rotationDeg: 13.5,
      imageScale: 1.23,
      imageOffsetXPercent: 17,
      imageOffsetYPercent: -19,
      imageRotationDeg: 23,
      imageFlipX: true,
      imageFlipY: true,
      columns: 3,
      columnGutterMm: 6.5,
      columnRule: true,
      columnBalance: true,
      fillColor: '#abcdef',
      fillTintPercent: 73,
      fillOpacity: 0.81,
      fillGradient: { type: 'linear', fromColor: '#010203', toColor: '#fefdfc', angleDeg: 137 },
      strokeColor: '#654321',
      strokeTintPercent: 63,
      strokeOpacity: 0.72,
      strokeWidthMm: 0.87,
      strokeStyle: 'double',
      cornerRadiusMm: 8.5,
      opacity: 0.91,
      textBoxXPercent: 11,
      textBoxYPercent: 12,
      textBoxWidthPercent: 73,
      textBoxHeightPercent: 64,
      textRotationDeg: 9,
      textVerticalAlign: 'bottom',
      textStrokeColor: '#aabbcc',
      textStrokeWidthMm: 0.42,
      textShadowColor: '#223344',
      textShadowOffsetXMm: 1.25,
      textShadowOffsetYMm: -1.5,
      textShadowBlurMm: 2.75,
      textSkewXDeg: 3.5,
      textSkewYDeg: -4.5,
      textScaleX: 1.14,
      textScaleY: 0.86,
      textArcPercent: 28,
      bubbleShape: 'squircle',
      bubbleWarp: 0.17,
      bubbleWarpLeft: 0.5,
      bubbleWarpRight: -0.2,
      bubbleWarpTop: 0.4,
      bubbleWarpBottom: -0.3,
      bubblePinchXPercent: 61,
      bubblePinchYPercent: 76,
      bubbleTailWidthPercent: 19,
      bubbleTailCurvePercent: 57,
      bubbleChainId: 'chain-geometry',
      bubbleChainOrder: 4,
      bubbleConnectorStyle: 'bridge',
      bubbleConnectorAnchor: 'top',
      bubbleConnectorGeometry: {
        fromAngleDeg: 42,
        toAngleDeg: 221,
        control1AlongPercent: 25,
        control1OffsetPercent: -13,
        control2AlongPercent: 72,
        control2OffsetPercent: 18,
        widthMm: 3.25,
        taperPercent: 44,
      },
      tailXPercent: 71,
      tailYPercent: 94,
      zIndex: 9,
      typography: expect.objectContaining({
        fontFamily: 'Georgia, serif',
        fontSizePt: 17,
        leadingPt: 21,
        tracking: 45,
        fontKerning: 'none',
        align: 'justify',
        hyphenate: false,
        color: '#123456',
        fontWeight: '600',
        fontStyle: 'italic',
        firstLineIndentMm: 4.25,
        alignLast: 'center',
        smallCaps: true,
        numericStyle: 'tabular',
        dropCapLines: 3,
        spaceBeforeMm: 1.5,
        spaceAfterMm: 2.5,
        lineBreak: 'pretty',
      }),
    }));
  });

  it('drops legacy inline binary fields when synchronously parsing Paper JSON', () => {
    const legacy = createDefaultPaperDocument({ title: 'Legacy binary fields' });
    legacy.pages[0].frames = [{
      id: 'legacy-image',
      kind: 'image',
      xMm: 10,
      yMm: 12,
      widthMm: 50,
      heightMm: 30,
      asset: {
        label: 'Legacy panel',
        kind: 'image',
        src: 'data:image/png;base64,AQID',
      },
    }] as never;
    (legacy as unknown as { importedFonts: unknown[] }).importedFonts = [{
      id: 'legacy-face',
      familyName: 'Legacy Face',
      bold: false,
      italic: false,
      format: 'truetype',
      embeddable: true,
      canSubset: true,
      dataBase64: 'BAUG',
    }];

    const parsed = parsePaperDocument(JSON.stringify(legacy));

    expect(JSON.stringify(parsed)).not.toMatch(/data:image|dataBase64|AQID|BAUG/i);
    expect(parsed.pages[0].frames[0].asset).toEqual({ label: 'Legacy panel', kind: 'image' });
    expect(parsed.importedFonts).toEqual([]);
  });

  it('drops malformed managed ICC metadata during Paper JSON parsing', () => {
    const document = createDefaultPaperDocument({ title: 'Malformed ICC metadata' });
    (document as unknown as { managedIccProfiles: unknown[] }).managedIccProfiles = [{
      id: 'not-a-content-addressed-id',
      asset: { id: 'not-a-content-addressed-id' },
      description: 'Unsafe inline profile',
      bytes: 'not allowed',
    }];

    const parsed = parsePaperDocument(JSON.stringify(document));

    expect(parsed.managedIccProfiles).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain('not allowed');
  });

  it('resolves assigned parent page frames into canvas and print output with detach overrides', () => {
    let doc = createDefaultPaperDocument({ title: 'Parents' });
    const pageId = doc.pages[0].id;
    const parentId = doc.parentPages[0].id;
    doc = addFrameToPaperParentPage(doc, parentId, {
      kind: 'caption',
      xMm: 5,
      yMm: 6,
      widthMm: 40,
      heightMm: 10,
      text: 'Folio',
    }).document;
    doc = assignPaperParentPage(doc, pageId, parentId);

    const inherited = resolvePaperPageFramesForOutput(doc, doc.pages[0]);
    expect(inherited[0]).toEqual(expect.objectContaining({ inherited: true, locked: true, text: 'Folio' }));
    expect(exportPaperDocumentToPrintHtml(doc)).toContain('Folio');

    const detached = detachInheritedPaperFrame(doc, pageId, inherited[0].id);
    expect(detached.frameId).toBeTruthy();
    expect(detached.document.pages[0].frames[0]).toEqual(expect.objectContaining({ inherited: false, locked: false, text: 'Folio' }));
  });

  it('keeps inherited and negative translucent frames above the page background in print output', () => {
    let doc = createDefaultPaperDocument({ title: 'Visible parent artwork' });
    const pageId = doc.pages[0].id;
    const parentId = doc.parentPages[0].id;
    doc = addFrameToPaperParentPage(doc, parentId, {
      id: 'parent-blue-rule',
      kind: 'panel',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 1,
      fillColor: '#1239b8',
      strokeWidthMm: 0,
      zIndex: 0,
    }).document;
    doc = assignPaperParentPage(doc, pageId, parentId);
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'translucent-black-panel',
      kind: 'panel',
      xMm: 20,
      yMm: 30,
      widthMm: 60,
      heightMm: 25,
      fillColor: '#000000',
      fillOpacity: 0.45,
      opacity: 0.8,
      strokeWidthMm: 0,
      zIndex: -5,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('background: #1239b8');
    expect(html).toContain('background: rgba(0, 0, 0, 0.45)');
    expect(html).toContain('opacity: 0.8');
    expect(html).toContain('z-index: 100');
    expect(html).toContain('z-index: 101');
    expect(html).not.toContain('z-index: -100000');
    expect(html).not.toContain('z-index: -5');
  });

  it('mirrors canvas wrapping, numeric, indent, and column typography in print output', () => {
    let doc = createDefaultPaperDocument({ title: 'Typography parity' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'balanced-columns',
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 90,
      heightMm: 50,
      text: 'Balanced copy that should wrap exactly like the canvas.',
      columns: 2,
      columnGutterMm: 7,
      columnBalance: true,
      columnRule: true,
      strokeColor: '#1239b8',
      typography: {
        lineBreak: 'balance',
        firstLineIndentMm: 3,
        alignLast: 'center',
        smallCaps: true,
        numericStyle: 'tabular',
      },
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('text-wrap-style: balance');
    expect(html).toContain('text-indent: 3mm each-line');
    expect(html).toContain('text-align-last: center');
    expect(html).toContain('font-variant-caps: small-caps');
    expect(html).toContain('font-variant-numeric: tabular-nums');
    expect(html).toContain('column-count: 2');
    expect(html).toContain('column-gap: 7mm');
    expect(html).toContain('column-fill: balance');
    expect(html).toContain('column-rule: 0.2mm solid #1239b8');
  });

  it('resolves live page frames in z-index order so caption stacking updates the canvas order', () => {
    let doc = createDefaultPaperDocument({ title: 'Caption Stack' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'panel-art',
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 60,
      zIndex: 2,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'caption-copy',
      kind: 'caption',
      xMm: 18,
      yMm: 20,
      widthMm: 52,
      heightMm: 16,
      text: 'Caption should stack behind the bubble.',
      zIndex: 0,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'dialogue',
      kind: 'speechBubble',
      xMm: 24,
      yMm: 26,
      widthMm: 45,
      heightMm: 24,
      text: 'Top bubble',
      zIndex: 1,
    }).document;

    expect(resolvePaperPageFramesForOutput(doc, doc.pages[0]).map((frame) => frame.id)).toEqual([
      'caption-copy',
      'dialogue',
      'panel-art',
    ]);
  });

  it('exports chained bubble connector artwork with print HTML and flattened-page parity', () => {
    let doc = createDefaultPaperDocument({ title: 'Bubble Chain Export' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'bubble-a',
      kind: 'speechBubble',
      xMm: 20,
      yMm: 28,
      widthMm: 44,
      heightMm: 24,
      text: 'First',
      bubbleChainId: 'chain-1',
      bubbleChainOrder: 1,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'bubble-b',
      kind: 'speechBubble',
      xMm: 84,
      yMm: 36,
      widthMm: 44,
      heightMm: 24,
      text: 'Second',
      bubbleChainId: 'chain-1',
      bubbleChainOrder: 2,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('class="paper-bubble-connectors"');
    expect(html).toContain('data-paper-bubble-connector-id="chain-1:bubble-a:bubble-b"');
    expect(html).toContain('x1="61.961"');
    expect(html).toContain('x2="86.039"');
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });

  it('exports same-speaker bridges above preceding page art and below their linked bubbles', () => {
    let doc = createDefaultPaperDocument({ title: 'Visible Bubble Bridge' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'panel-art',
      kind: 'image',
      xMm: 0,
      yMm: 0,
      widthMm: doc.page.widthMm,
      heightMm: doc.page.heightMm,
      zIndex: 0,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'bubble-a',
      kind: 'speechBubble',
      xMm: 20,
      yMm: 28,
      widthMm: 44,
      heightMm: 24,
      fillColor: '#fef3c7',
      strokeStyle: 'dashed',
      bubbleChainId: 'bridge-chain',
      bubbleChainOrder: 1,
      bubbleConnectorStyle: 'bridge',
      zIndex: 1,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'bubble-b',
      kind: 'speechBubble',
      xMm: 84,
      yMm: 36,
      widthMm: 44,
      heightMm: 24,
      bubbleChainId: 'bridge-chain',
      bubbleChainOrder: 2,
      bubbleConnectorStyle: 'bridge',
      zIndex: 2,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('class="paper-bubble-connectors" data-paper-canvas-z-index="101"');
    expect(html).toContain('data-paper-bubble-compound-id="bridge-chain:bubble-a:bubble-b:compound"');
    expect(html).toContain('data-paper-bubble-compound-members="bubble-a bubble-b"');
    expect(html).toContain('<path');
    expect(html).toContain('fill="#fef3c7"');
    expect(html).toContain('stroke-dasharray="2 1.6"');
    expect(html).not.toContain('paper-bubble-shape');
  });

  it('places newly created frames above the existing page stack when z-index is implicit', () => {
    let doc = createDefaultPaperDocument({ title: 'Default Stack' });
    const pageId = doc.pages[0].id;
    const first = addFrameToPaperPage(doc, pageId, {
      id: 'first-caption',
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 50,
      heightMm: 12,
    });
    doc = first.document;
    const second = addFrameToPaperPage(doc, pageId, {
      id: 'second-caption',
      kind: 'caption',
      xMm: 12,
      yMm: 12,
      widthMm: 50,
      heightMm: 12,
    });
    doc = second.document;

    expect(doc.pages[0].frames.map((frame) => [frame.id, frame.zIndex])).toEqual([
      ['first-caption', 0],
      ['second-caption', 1],
    ]);
  });

  it('computes effective paragraph, character, and object styles for frames', () => {
    let doc = createDefaultPaperDocument({ title: 'Styles' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 50,
      heightMm: 20,
      paragraphStyleId: 'para-caption',
      characterStyleId: 'char-emphasis',
      objectStyleId: 'obj-caption-box',
    });
    doc = added.document;

    const frame = doc.pages[0].frames.find((candidate) => candidate.id === added.frameId)!;
    const effective = computeEffectivePaperFrame(doc, frame);

    expect(effective.typography.fontFamily).toBe('Georgia, serif');
    expect(effective.typography.fontStyle).toBe('italic');
    expect(effective.fillColor).toBe('#fff4bf');
    expect(exportPaperDocumentToPrintHtml(doc)).toContain('font-family: Georgia, serif');
  });

  it('supports common page presets, custom sizes, bleed, margins, columns, grids, and DPI', () => {
    expect(Object.keys(PAPER_PAGE_PRESETS)).toEqual(expect.arrayContaining([
      'us-letter',
      'us-legal',
      'tabloid',
      'a4',
      'a5',
      'square-8',
      'comic-book',
      'manga-digest',
      'webtoon-panel',
    ]));
    expect(paperPixelsFromMm(25.4, 300)).toBe(300);

    const doc = createDefaultPaperDocument({
      title: 'Custom Print Setup',
      preset: 'comic-book',
      dpi: 600,
    });
    expect(doc.page.widthMm).toBe(170);
    expect(doc.page.dpi).toBe(600);

    const custom = updatePaperDocumentSetup(doc, {
      preset: 'custom',
      widthMm: 148,
      heightMm: 210,
      dpi: 450,
      bleedMm: 5,
      marginsMm: { top: 11, right: 12, bottom: 13, left: 14 },
      columns: { count: 4, gutterMm: 4.25 },
      grid: { enabled: true, sizeMm: 4, subdivisions: 8 },
    });

    expect(custom.page).toMatchObject({
      preset: 'custom',
      widthMm: 148,
      heightMm: 210,
      dpi: 450,
      bleedMm: 5,
    });
    expect(custom.layout.marginsMm).toEqual({ top: 11, right: 12, bottom: 13, left: 14 });
    expect(custom.layout.columns).toEqual({ count: 4, gutterMm: 4.25 });
    expect(custom.layout.grid).toEqual({ enabled: true, sizeMm: 4, subdivisions: 8 });
    expect(custom.pages[0].guides.some((guide) => guide.positionMm === 74)).toBe(true);
  });

  it('supports solid, linear-gradient, and radial-gradient document backgrounds in print export', () => {
    const solid = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Solid Background' }), {
      background: { type: 'solid', color: '#111827' },
    });
    expect(paperDocumentBackgroundCss(solid.background)).toBe('#111827');
    expect(exportPaperDocumentToPrintHtml(solid)).toContain('background: #111827;');

    const linear = updatePaperDocumentSetup(solid, {
      background: {
        type: 'linear-gradient',
        fromColor: '#fef3c7',
        toColor: '#67e8f9',
        angleDeg: 135,
      },
    });
    expect(paperDocumentBackgroundCss(linear.background)).toBe('linear-gradient(135deg, #fef3c7, #67e8f9)');
    expect(exportPaperDocumentToPrintHtml(linear)).toContain('background: linear-gradient(135deg, #fef3c7, #67e8f9);');

    const radial = updatePaperDocumentSetup(linear, {
      background: {
        type: 'radial-gradient',
        fromColor: '#ffffff',
        toColor: '#0f172a',
        radialShape: 'circle',
      },
    });
    expect(paperDocumentBackgroundCss(radial.background)).toBe('radial-gradient(circle, #ffffff, #0f172a)');
  });

  it('sanitizes unsafe document background values back to print-safe defaults', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Unsafe Background' }), {
      background: {
        type: 'linear-gradient',
        color: 'url(https://example.test/leak)',
        fromColor: 'var(--bad)',
        toColor: '#67e8f9',
        angleDeg: Number.POSITIVE_INFINITY,
      },
    });

    expect(doc.background).toMatchObject({
      type: 'linear-gradient',
      color: '#ffffff',
      fromColor: '#ffffff',
      toColor: '#67e8f9',
      angleDeg: 90,
    });
  });

  it('places source-library image assets into image frames without losing print-frame metadata', () => {
    const doc = createDefaultPaperDocument({ title: 'Placed Asset' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'image',
      xMm: 20,
      yMm: 25,
      widthMm: 80,
      heightMm: 55,
      label: 'Panel 1',
      fit: 'cover',
    });

    const placed = placeSourceAssetInPaperFrame(withFrame, {
      pageId,
      frameId,
      item: makeImageItem(),
    });
    const frame = placed.pages[0].frames.find((candidate) => candidate.id === frameId);

    expect(frame?.kind).toBe('image');
    expect(frame?.asset?.sourceBinItemId).toBe('asset-panel-1');
    expect(frame?.asset?.locator).toBeUndefined();
    expect(frame?.fit).toBe('cover');
    expect(frame?.imageScale).toBe(1);
    expect(frame?.imageOffsetXPercent).toBe(0);
    expect(frame?.widthMm).toBe(80);
  });

  it('records a swatch id on the fill and auto-clears it when the fill changes another way', () => {
    const doc = createDefaultPaperDocument({ title: 'Spot ref', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, { kind: 'caption', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20 });
    const frameOf = (d: typeof doc) => d.pages.find((p) => p.id === pageId)!.frames.find((f) => f.id === frameId)!;

    // Applying a swatch records the durable link (fillColor + fillSwatchId set together).
    const applied = updatePaperFrame(withFrame, pageId, frameId, { fillColor: '#ff8800', fillSwatchId: 'sw-spot' });
    expect(frameOf(applied).fillSwatchId).toBe('sw-spot');

    // Changing the fill by any other path (no fillSwatchId in the patch) drops the link so it can't go stale.
    const recolored = updatePaperFrame(applied, pageId, frameId, { fillColor: '#00aaff' });
    expect(frameOf(recolored).fillColor).toBe('#00aaff');
    expect(frameOf(recolored).fillSwatchId).toBeUndefined();
  });

  it('keeps a swatch-backed fill tint bounded while preserving its durable swatch identity', () => {
    const doc = createDefaultPaperDocument({ title: 'Tinted spot ref', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
    });
    const frameOf = (d: typeof doc) => d.pages.find((page) => page.id === pageId)!.frames.find((frame) => frame.id === frameId)!;

    const tinted = updatePaperFrame(withFrame, pageId, frameId, {
      fillColor: 'rgb(241, 131, 137)',
      fillSwatchId: 'sw-spot',
      fillTintPercent: 50,
    });
    expect(frameOf(tinted).fillSwatchId).toBe('sw-spot');
    expect(frameOf(tinted).fillTintPercent).toBe(50);

    const bounded = updatePaperFrame(tinted, pageId, frameId, {
      fillColor: 'rgb(227, 6, 19)',
      fillSwatchId: 'sw-spot',
      fillTintPercent: 140,
    });
    expect(frameOf(bounded).fillSwatchId).toBe('sw-spot');
    expect(frameOf(bounded).fillTintPercent).toBe(100);
  });

  it('records a swatch id on the TEXT colour and auto-clears it when the colour changes another way', () => {
    const doc = createDefaultPaperDocument({ title: 'Text spot ref', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, { kind: 'caption', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20, text: 'Logo' });
    const frameOf = (d: typeof doc) => d.pages.find((p) => p.id === pageId)!.frames.find((f) => f.id === frameId)!;

    // Applying a swatch to the text colour records the durable link (color + colorSwatchId together).
    const applied = updatePaperFrame(withFrame, pageId, frameId, { typography: { ...frameOf(withFrame).typography, color: '#e30613', colorSwatchId: 'sw-spot' } });
    expect(frameOf(applied).typography.colorSwatchId).toBe('sw-spot');

    // Recolouring the text any other way (no colorSwatchId in the patch) drops the link.
    const recolored = updatePaperFrame(applied, pageId, frameId, { typography: { ...frameOf(applied).typography, color: '#123456' } });
    expect(frameOf(recolored).typography.color).toBe('#123456');
    expect(frameOf(recolored).typography.colorSwatchId).toBeUndefined();
  });

  it('records a swatch id on the STROKE colour and auto-clears it when the stroke changes another way', () => {
    const doc = createDefaultPaperDocument({ title: 'Stroke spot ref', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, { kind: 'shape', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20 });
    const frameOf = (d: typeof doc) => d.pages.find((p) => p.id === pageId)!.frames.find((f) => f.id === frameId)!;

    // Applying a swatch to the stroke records the durable link (strokeColor + strokeSwatchId together).
    const applied = updatePaperFrame(withFrame, pageId, frameId, { strokeColor: '#e30613', strokeSwatchId: 'sw-spot' });
    expect(frameOf(applied).strokeSwatchId).toBe('sw-spot');

    // Changing the stroke any other way (no strokeSwatchId in the patch) drops the link so it can't go stale.
    const recolored = updatePaperFrame(applied, pageId, frameId, { strokeColor: '#00aaff' });
    expect(frameOf(recolored).strokeColor).toBe('#00aaff');
    expect(frameOf(recolored).strokeSwatchId).toBeUndefined();
  });

  it('defaults a new text frame to a single column so its type vectorizes (real embedded font) by default', () => {
    const doc = createDefaultPaperDocument({ title: 'Columns default', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withText, frameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 120,
      text: 'Body copy that should embed as selectable vector text.',
    });
    const frame = withText.pages[0].frames.find((f) => f.id === frameId);
    // A default text frame is single-column; the vector-text engine only vectorizes columns === 1, so this
    // is what makes real-font embedding work for body text without the user changing anything. Multi-column
    // is still available on demand (and correctly rasterizes).
    expect(frame?.columns).toBe(1);
  });

  it('exports print HTML with page size, bleed, crop marks, columns, and placed assets', () => {
    const doc = createDefaultPaperDocument({ title: 'Print Export', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withTextFrame, frameId: textFrameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 120,
      text: 'A long page of editorial copy.',
      columns: 3,
    });
    const withStyledText = updatePaperFrame(withTextFrame, pageId, textFrameId, {
      typography: {
        fontFamily: 'Inter',
        fontSizePt: 11,
        leadingPt: 14,
        tracking: 10,
        align: 'justify',
        hyphenate: true,
      },
    });
    const { document: withImageFrame, frameId: imageFrameId } = addFrameToPaperPage(withStyledText, pageId, {
      kind: 'image',
      xMm: 112,
      yMm: 18,
      widthMm: 70,
      heightMm: 70,
      label: 'Panel art slot',
      fit: 'cover',
      imageScale: 1.25,
      imageOffsetXPercent: 10,
      imageOffsetYPercent: -5,
      imageRotationDeg: 15,
    });
    const item = makeImageItem();
    const placed = placeSourceAssetInPaperFrame(withImageFrame, {
      pageId,
      frameId: imageFrameId,
      item,
    });

    const html = exportPaperDocumentToPrintHtml(placed, {
      resolveAssetUrl: (frame) => frame.asset?.sourceBinItemId === item.id ? item.assetUrl : undefined,
    });

    expect(html).toContain('@page');
    expect(html).toContain('size: 221.9mm 285.4mm');
    expect(html).toContain('name="signal-loom-paper-dpi" content="300"');
    expect(html).toContain('bleed: 3mm');
    expect(html).toContain('crop');
    expect(html).toContain('class="paper-sheet"');
    expect(html).toContain('width: 221.9mm;');
    expect(html).toContain('height: 285.4mm;');
    expect(html).toContain('left: 3mm;');
    expect(html).toContain('top: 3mm;');
    expect(html).toContain('column-count: 3');
    expect(html).toContain('hyphens: auto');
    expect(html).toContain('Panel Art');
    expect(html).toContain('data:image/png;base64,abc123');
    expect(html).toContain('class="frame-content"');
    expect(html).toContain('padding: 2mm');
    expect(html).toContain('object-position: 50% 50%');
    expect(html).toContain('position: absolute; width: 125%; height: 125%; max-width: none; max-height: none; left: 60%; top: 45%');
    expect(html).toContain('transform: translate(-50%, -50%) rotate(15deg)');
  });

  it('exports rich-text runs and paragraph formatting to print HTML (bold run, bullet list, paragraph spacing)', () => {
    const doc = createDefaultPaperDocument({ title: 'Rich Print Export', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 60,
      richText: [
        { runs: [{ text: 'Plain then ' }, { text: 'bold', fontWeight: '700' }, { text: ' word.' }], spaceAfterMm: 4 },
        { runs: [{ text: 'Bulleted item' }], listMarker: '•' },
      ],
    });

    const html = exportPaperDocumentToPrintHtml(withFrame);

    // Per-run styling survives export: the bold run gets its own styled span; plain runs stay unstyled —
    // NOT flattened to one plain-text string (the bug: PDF/PNG export used to drop every run's formatting).
    expect(html).toContain('<span>Plain then </span>');
    expect(html).toContain('<span style="font-weight: 700">bold</span>');
    expect(html).toContain('<span> word.</span>');
    // Paragraph-level spacing survives.
    expect(html).toContain('margin-bottom: 4mm');
    // The bullet paragraph gets a real hanging list marker (prefix span + negative text-indent), not the
    // literal "•\t" flattened-text marker.
    expect(html).toContain('<span>• </span>');
    expect(html).toContain('text-indent: -4.5mm');
    expect(html).not.toContain('•\tBulleted item');
  });

  it('preserves each-line rich paragraph indentation in print HTML', () => {
    const doc = createDefaultPaperDocument({ title: 'Each-line rich indent', preset: 'us-letter' });
    const { document: withFrame } = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 60,
      richText: [{
        runs: [{ text: 'Every rendered line must carry the paragraph indent.' }],
        firstLineIndentMm: 4.25,
      }],
    });

    expect(exportPaperDocumentToPrintHtml(withFrame)).toContain('text-indent: 4.25mm each-line');
  });

  it('keeps plain-text frames byte-identical in print HTML when richText is absent (export regression)', () => {
    const doc = createDefaultPaperDocument({ title: 'Plain Print Regression', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    const { document: withFrame } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 40,
      text: 'Plain frame, no rich runs.',
    });

    const html = exportPaperDocumentToPrintHtml(withFrame);

    // Exactly the pre-existing plain-text markup — no rich-paragraph wrapper, no per-run spans. (The
    // stylesheet always defines `.paper-dropcap::first-letter` — like the other always-present frame rules
    // — but nothing in THIS document's markup references the class.)
    expect(html).toContain('<div class="frame-text-content" style="">Plain frame, no rich runs.</div>');
    expect(html).not.toContain('class="paper-dropcap"');
    expect(html).not.toContain('<span>Plain frame');
  });

  it('preserves a plain-text frame drop cap in print HTML', () => {
    const doc = createDefaultPaperDocument({ title: 'Plain Drop Cap', preset: 'us-letter' });
    const { document: withFrame } = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 40,
      text: 'The opening letter spans three lines.',
      typography: { dropCapLines: 3 },
    });

    const html = exportPaperDocumentToPrintHtml(withFrame);

    expect(html).toContain('<div class="paper-dropcap" style="--sl-dropcap-lines: 3">The opening letter spans three lines.</div>');
  });

  it('inherits a frame drop cap only into the opening rich paragraph', () => {
    const doc = createDefaultPaperDocument({ title: 'Rich Opening Drop Cap', preset: 'us-letter' });
    const { document: withFrame } = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'text',
      xMm: 18,
      yMm: 18,
      widthMm: 90,
      heightMm: 80,
      typography: { dropCapLines: 3 },
      richText: [
        { runs: [{ text: 'The story opening inherits the frame treatment.' }] },
        { runs: [{ text: 'This ordinary paragraph must not inherit it.' }] },
        { runs: [{ text: 'An explicitly styled later paragraph may still opt in.' }], dropCapLines: 2 },
      ],
    });

    const html = exportPaperDocumentToPrintHtml(withFrame);

    expect(html.match(/class="paper-dropcap"/g)).toHaveLength(2);
    expect(html).toContain('--sl-dropcap-lines: 3');
    expect(html).toContain('--sl-dropcap-lines: 2');
  });

  it('exports image content inside the same padded frame-content box used by the live canvas', () => {
    const doc = createDefaultPaperDocument({ title: 'Image Frame Export' });
    const pageId = doc.pages[0].id;
    const { document: withImageFrame, frameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'image',
      xMm: 12,
      yMm: 18,
      widthMm: 70,
      heightMm: 48,
      label: 'Inset panel art',
      fit: 'cover',
      imageScale: 1.15,
      imageOffsetXPercent: -8,
      imageOffsetYPercent: 14,
      imageRotationDeg: -3,
    });
    const item = makeImageItem();
    const placed = placeSourceAssetInPaperFrame(withImageFrame, {
      pageId,
      frameId,
      item,
    });

    const html = exportPaperDocumentToPrintHtml(placed, {
      resolveAssetUrl: (frame) => frame.asset?.sourceBinItemId === item.id ? item.assetUrl : undefined,
    });

    expect(html).toContain('.frame { position: absolute; margin: 0; overflow: visible; }');
    expect(html).toContain('<figure class="frame frame-image"');
    expect(html).toContain('class="frame-content"');
    expect(html).toContain('overflow: hidden');
    expect(html).toContain('padding: 2mm');
    expect(html).toContain('object-position: 50% 50%');
    expect(html).toContain('position: absolute; width: 115%; height: 115%; max-width: none; max-height: none; left: 42%; top: 64%');
    expect(html).toContain('transform: translate(-50%, -50%) rotate(-3deg)');
  });

  it('exports caption text through the same vertical alignment box as the editor', () => {
    let doc = createDefaultPaperDocument({ title: 'Caption Alignment' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'caption-1',
      kind: 'caption',
      xMm: 10,
      yMm: 14,
      widthMm: 80,
      heightMm: 14,
      text: 'Centered narration.',
      textVerticalAlign: 'middle',
      typography: {
        align: 'center',
      },
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('class="frame frame-caption"');
    expect(html).toContain('class="frame-content"');
    expect(html).toContain('display: flex');
    expect(html).toContain('justify-content: center');
    expect(html).toContain('class="frame-text-content"');
    expect(html).toContain('Centered narration.');
    // Regression: the caption box (border/fill/padding) must come only from `.frame-content`,
    // never a second `.frame-caption` border. A duplicate border here double-outlined captions
    // and its extra padding shrank the text box so captions that fit in the editor clipped on export.
    expect(html).not.toMatch(/\.frame-caption\s*\{[^}]*\bborder\b/);
    // Print-safe fonts: the non-deterministic `system-ui` keyword must never reach exported output;
    // it resolves differently in the SVG->canvas raster than in the editor DOM.
    expect(html).not.toMatch(/system-ui/);
  });

  it('uses explicit sheet dimensions for PDF bleed instead of relying only on CSS paged-media bleed', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Bleed Export', preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 5,
    });

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('@page');
    expect(html).toContain('size: 110mm 160mm');
    expect(html).toContain('bleed: 5mm');
    expect(html).toContain('width: 110mm;');
    expect(html).toContain('height: 160mm;');
    expect(html).toContain('left: 5mm;');
    expect(html).toContain('top: 5mm;');
    expect(html).toContain('data-trim-width="100mm"');
    expect(html).toContain('data-trim-height="150mm"');
  });

  it('can export trim-aligned print HTML for native PDF so content is not pushed by bleed', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Trim PDF', preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 5,
    });

    const html = exportPaperDocumentToPrintHtml(doc, { mediaBox: 'trim' });

    expect(html).toContain('size: 100mm 150mm');
    expect(html).toContain('bleed: 5mm');
    expect(html).toContain('width: 100mm;');
    expect(html).toContain('height: 150mm;');
    expect(html).toContain('left: 0mm;');
    expect(html).toContain('top: 0mm;');
    expect(html).toContain('data-bleed="5mm"');
  });

  it('draws configured crop marks on an expanded sheet and reserves a separate slug area', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Marked PDF', preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: {
        marks: { cropMarks: true, slugAreaMm: 12 },
      },
    });

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('size: 120mm 182mm');
    expect(html.match(/data-production-mark=/g)).toHaveLength(8);
    expect(html).toContain('data-production-mark="crop:top-left:horizontal"');
    expect(html).toContain('stroke="#000000" stroke-width="0.25"');
    expect(html).toContain('data-slug-area-mm="12"');
    expect(html).toContain('data-bleed-box="7mm 7mm 106mm 156mm"');
    expect(html).toContain('signal-loom-paper-crop-marks" content="true"');
    expect(html).toContain('signal-loom-paper-slug-area-mm" content="12"');
  });

  it('renders registration marks, CMYK bars, and escaped editable slug information into print HTML', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Production sheet', preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: {
        marks: { cropMarks: true, registrationMarks: true, colorBars: true, slugAreaMm: 14 },
        jobInfo: {
          jobName: 'Catalog <proof>',
          jobNumber: 'CAT-42',
          client: 'Example & Co.',
          author: 'A. Operator',
          notes: 'Coated stock',
        },
      },
    });

    const html = exportPaperDocumentToPrintHtml(doc);
    expect(html).toContain('data-production-mark="registration:top:circle"');
    expect(html).toContain('data-registration-cmyk="1 1 1 1"');
    expect(html).toContain('data-production-mark="color-bar:cyan"');
    expect(html).toContain('data-process-cmyk="1 0 0 0"');
    expect(html).toContain('Job: Catalog &lt;proof&gt;');
    expect(html).toContain('Client: Example &amp; Co.');
    expect(html).toContain('signal-loom-paper-registration-marks" content="true"');
    expect(html).toContain('signal-loom-paper-color-bars" content="true"');
    expect(html).toContain('signal-loom-paper-job-number" content="CAT-42"');
  });

  it('can suppress production marks for isolated trim/bleed raster adapters', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: { marks: { cropMarks: true, slugAreaMm: 12 } },
    });

    const html = exportPaperDocumentToPrintHtml(doc, { includeProductionMarks: false });

    expect(html).toContain('size: 106mm 156mm');
    expect(html).not.toContain('data-production-mark=');
    expect(html).not.toContain('class="paper-slug-area"');
  });

  it('keeps preview-only margin guides out of print HTML unless explicitly requested', () => {
    const doc = createDefaultPaperDocument({ title: 'Clean Print', preset: 'comic-book' });

    expect(exportPaperDocumentToPrintHtml(doc)).not.toContain('.paper-page::after');
    expect(exportPaperDocumentToPrintHtml(doc)).not.toContain('rgba(6, 182, 212');
    expect(exportPaperDocumentToPrintHtml(doc, { includeScreenGuides: true })).toContain('.paper-page::after');
  });

  it('exports print-production metadata for press proof and package workflows', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Press Metadata', preset: 'comic-book' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'gracol-2013-coated',
        totalInkLimitPercent: 300,
        blackPolicy: 'force-100k-text',
        spotColorPolicy: 'warn',
        overprintPreview: true,
      },
    });

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('name="signal-loom-paper-pdf-standard" content="pdf-x-4"');
    expect(html).toContain('name="signal-loom-paper-output-intent-profile" content="gracol-2013-coated"');
    expect(html).toContain('name="signal-loom-paper-output-intent-label" content="GRACoL 2013 Coated / CRPC6"');
    expect(html).toContain('name="signal-loom-paper-output-intent-color-space" content="cmyk"');
    expect(html).toContain('name="signal-loom-paper-total-ink-limit" content="300"');
    expect(html).toContain('name="signal-loom-paper-overprint-preview" content="true"');
  });

  it('exports SVG-backed Paper shapes and bubbles with concrete line, ellipse, polygon, dash, and gradient markup', () => {
    let doc = createDefaultPaperDocument({ title: 'Shape Export', preset: 'comic-book' });
    const pageId = doc.pages[0].id;

    doc = addFrameToPaperPage(doc, pageId, {
      id: 'line-1',
      kind: 'shape',
      shapeKind: 'line',
      xMm: 10,
      yMm: 12,
      widthMm: 40,
      heightMm: 5,
      strokeStyle: 'dotted',
      strokeWidthMm: 0.5,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'ellipse-1',
      kind: 'shape',
      shapeKind: 'ellipse',
      xMm: 20,
      yMm: 25,
      widthMm: 50,
      heightMm: 38,
      fillGradient: {
        type: 'linear',
        fromColor: '#67e8f9',
        toColor: '#f9a8d4',
        angleDeg: 135,
      },
      fillOpacity: 0.75,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'speech-1',
      kind: 'speechBubble',
      xMm: 30,
      yMm: 70,
      widthMm: 60,
      heightMm: 34,
      fillGradient: {
        type: 'linear',
        fromColor: '#fef3c7',
        toColor: '#f9a8d4',
        angleDeg: 90,
      },
      strokeStyle: 'dashed',
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'poly-1',
      kind: 'shape',
      shapeKind: 'hexagon',
      xMm: 90,
      yMm: 40,
      widthMm: 40,
      heightMm: 40,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);
    const bubbleSvgMarkup = decodeBubbleSvgSources(html).join('\n');

    expect(html).toContain('<line x1="0" y1="50" x2="100" y2="50"');
    expect(html).toContain('stroke-dasharray="1 3"');
    expect(html).toContain('<ellipse cx="50" cy="50" rx="48" ry="48"');
    expect(html).toContain('id="paper-gradient-ellipse-1"');
    expect(html).toContain('fill="url(#paper-gradient-ellipse-1)"');
    expect(html).toContain('fill-opacity="0.75"');
    expect(bubbleSvgMarkup).toContain('id="paper-gradient-speech-1"');
    expect(bubbleSvgMarkup).toContain('stroke-dasharray="5 4"');
    expect(html).toContain('<polygon points="25,0 75,0 100,50 75,100 25,100 0,50"');
  });

  it('exports speech-bubble text as an absolute inner text box so PDF layout matches the canvas', () => {
    let doc = createDefaultPaperDocument({ title: 'Speech Export', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'speech-box-1',
      kind: 'speechBubble',
      xMm: 30,
      yMm: 70,
      widthMm: 58,
      heightMm: 28,
      text: 'No one can own a dead person.',
      textBoxXPercent: 12,
      textBoxYPercent: 18,
      textBoxWidthPercent: 76,
      textBoxHeightPercent: 42,
      textRotationDeg: -7,
      textVerticalAlign: 'middle',
      typography: {
        align: 'center',
      },
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('class="frame frame-speechBubble"');
    expect(html).toContain('background: transparent; border: 0; padding: 0;');
    expect(html).toContain('position: absolute; left: 12%; top: 18%; width: 76%; height: 42%');
    expect(html).toContain('transform: rotate(-7deg)');
    expect(html).toContain('display: flex; flex-direction: column; justify-content: center');
    expect(html).toContain('text-align: center');
    expect(html).toContain('No one can own a dead person.');
  });

  it('exports bubble artwork as image-backed SVG so flattened raster PDFs keep the visible bubble shape', () => {
    let doc = createDefaultPaperDocument({ title: 'Raster Bubble Export', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'speech-raster-safe',
      kind: 'speechBubble',
      xMm: 30,
      yMm: 70,
      widthMm: 58,
      heightMm: 28,
      text: 'The shape must survive flattening.',
      tailXPercent: -12,
      tailYPercent: 135,
      bubblePinchXPercent: 42,
      bubblePinchYPercent: 82,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);
    const bubbleImageMatch = /<img class="paper-bubble-shape"[^>]+src="([^"]+)"/.exec(html);

    expect(bubbleImageMatch?.[1]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(html).not.toContain('<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style="position: absolute; inset: 0; overflow: visible;">');
    expect(html).toContain('left: -');
    expect(html).toContain('top: -');
    expect(decodeURIComponent(bubbleImageMatch?.[1] ?? '')).toContain('<path d="');
    expect(decodeURIComponent(bubbleImageMatch?.[1] ?? '')).toContain('fill="#ffffff"');
  });

  it('exports shaped image-frame strokes around the selected ellipse instead of a rectangular image border', () => {
    let doc = createDefaultPaperDocument({ title: 'Shaped Image Frame', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    const { document: withFrame, frameId } = addFrameToPaperPage(doc, pageId, {
      id: 'ellipse-image-frame',
      kind: 'image',
      shapeKind: 'ellipse',
      xMm: 20,
      yMm: 25,
      widthMm: 70,
      heightMm: 48,
      label: 'Oval panel art',
      strokeColor: '#c026d3',
      strokeStyle: 'dashed',
      strokeWidthMm: 1,
      fillColor: '#fff4bf',
    });
    doc = placeSourceAssetInPaperFrame(withFrame, {
      pageId,
      frameId,
      item: makeImageItem(),
    });

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('class="frame frame-image"');
    expect(html).toContain('background: transparent; border: 0;');
    expect(html).toContain('clip-path: ellipse(50% 50% at 50% 50%)');
    expect(html).toContain('<ellipse cx="50" cy="50" rx="48" ry="48" fill="none"');
    expect(html).toContain('stroke="#c026d3"');
    expect(html).toContain('stroke-width="1mm"');
    expect(html).toContain('stroke-dasharray="5 4"');
  });

  it('exports comic panel image frames with editable polygon vertices as the clipping path and stroke', () => {
    let doc = createDefaultPaperDocument({ title: 'Angled Panel', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    const { document: withPanel, frameId } = addFrameToPaperPage(doc, pageId, {
      id: 'angled-panel',
      kind: 'panel',
      xMm: 20,
      yMm: 25,
      widthMm: 70,
      heightMm: 48,
      label: 'Angled panel',
      vertices: [
        { xPercent: 0, yPercent: 10 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 92, yPercent: 100 },
        { xPercent: -8, yPercent: 88 },
      ],
    });
    doc = placeSourceAssetInPaperFrame(withPanel, {
      pageId,
      frameId,
      item: makeImageItem(),
    });

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).toContain('clip-path: polygon(0% 10%, 100% 0%, 92% 100%, -8% 88%)');
    expect(html).toContain('<polygon points="0,10 100,0 92,100 -8,88" fill="none"');
  });

  it('ignores stale triangle vertices on caption frames while exporting edited caption polygons', () => {
    let doc = createDefaultPaperDocument({ title: 'Caption Vertices', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'caption-stale-triangle',
      kind: 'caption',
      xMm: 12,
      yMm: 14,
      widthMm: 50,
      heightMm: 18,
      text: 'Caption',
      vertices: [
        { xPercent: 50, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'caption-edited-polygon',
      kind: 'caption',
      xMm: 20,
      yMm: 42,
      widthMm: 70,
      heightMm: 16,
      text: 'Edited caption',
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 88, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      id: 'caption-edited-triangle',
      kind: 'caption',
      xMm: 22,
      yMm: 68,
      widthMm: 46,
      heightMm: 18,
      text: 'Edited triangle',
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);

    expect(html).not.toContain('clip-path: polygon(50% 0%, 100% 100%, 0% 100%)');
    expect(html).toContain('clip-path: polygon(0% 0%, 100% 0%, 88% 100%, 0% 100%)');
    expect(html).toContain('<polygon points="0,0 100,0 88,100 0,100" fill="none"');
    expect(html).toContain('clip-path: polygon(0% 0%, 100% 100%, 0% 100%)');
    expect(html).toContain('<polygon points="0,0 100,100 0,100" fill="none"');
  });

  it('exports speech and thought bubble outlines with their tail geometry', () => {
    let doc = createDefaultPaperDocument({ title: 'Bubbles' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, {
      kind: 'speechBubble',
      xMm: 20,
      yMm: 20,
      widthMm: 70,
      heightMm: 40,
      text: 'Top tail',
      tailXPercent: 50,
      tailYPercent: 0,
      bubblePinchXPercent: 50,
      bubblePinchYPercent: 18,
    }).document;
    doc = addFrameToPaperPage(doc, pageId, {
      kind: 'thoughtBubble',
      xMm: 25,
      yMm: 70,
      widthMm: 70,
      heightMm: 40,
      text: 'Left tail',
      tailXPercent: 0,
      tailYPercent: 50,
      bubblePinchXPercent: 18,
      bubblePinchYPercent: 50,
    }).document;

    const html = exportPaperDocumentToPrintHtml(doc);
    const bubbleSvgMarkup = decodeBubbleSvgSources(html).join('\n');

    expect(html).toContain('Top tail');
    expect(html).toContain('Left tail');
    expect(bubbleSvgMarkup).toContain('50 0');
    expect(bubbleSvgMarkup).toContain('0 50');
  });
});

function decodeBubbleSvgSources(html: string): string[] {
  return Array.from(html.matchAll(/<img class="paper-bubble-shape"[^>]+src="([^"]+)"/g))
    .map((match) => decodeURIComponent(match[1]));
}

describe('effectiveRtlBinding (右綴じ auto-derive)', () => {
  it('auto-binds right-to-left when the document has vertical (縦書き) text', () => {
    const base = createDefaultPaperDocument({ title: 'Auto Manga' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 60,
      text: '縦書き本文', typography: { writingMode: 'vertical-rl' },
    });
    expect(document.view.rtlBinding).toBeUndefined(); // nothing pinned — pure auto
    expect(effectiveRtlBinding(document)).toBe(true);
  });

  it('auto-binds left-to-right for a horizontal (Western) document', () => {
    const base = createDefaultPaperDocument({ title: 'Auto Western' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20, text: 'Plain body',
    });
    expect(effectiveRtlBinding(document)).toBe(false);
  });

  it('lets an explicit view.rtlBinding override the auto-derivation either way', () => {
    const base = createDefaultPaperDocument({ title: 'Pinned' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 60,
      text: '縦書き', typography: { writingMode: 'vertical-rl' },
    });
    expect(effectiveRtlBinding({ ...document, view: { ...document.view, rtlBinding: false } })).toBe(false); // pin LTR on a vertical doc
    const western = createDefaultPaperDocument({ title: 'Pinned RTL' });
    expect(effectiveRtlBinding({ ...western, view: { ...western.view, rtlBinding: true } })).toBe(true); // pin RTL on a horizontal doc
  });
});
