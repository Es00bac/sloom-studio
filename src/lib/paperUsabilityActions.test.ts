import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  placeSourceAssetInPaperFrame,
} from './paperDocument';
import {
  PAPER_FRAME_CONTEXT_ACTIONS,
  PAPER_PAGE_CONTEXT_ACTIONS,
  addPaperPolygonShapeFrame,
  applyPaperFrameContextAction,
  applyPaperPageContextAction,
  nudgePaperFrame,
  splitPaperPanelFrame,
} from './paperUsabilityActions';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';

function imageItem(id = 'image-1'): SourceBinLibraryItem {
  return {
    id,
    label: `Image ${id}`,
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: `data:image/png;base64,${id}`,
    createdAt: 1,
  };
}

function textItem(): SourceBinLibraryItem {
  return {
    id: 'text-1',
    label: 'Caption copy',
    kind: 'text',
    text: 'Imported narration.',
    createdAt: 1,
  };
}

function seededDocument() {
  let doc = createDefaultPaperDocument({ title: 'Menu Actions' });
  const pageId = doc.pages[0].id;
  const first = addFrameToPaperPage(doc, pageId, {
    id: 'frame-a',
    kind: 'image',
    label: 'A',
    xMm: 12,
    yMm: 13,
    widthMm: 40,
    heightMm: 30,
    zIndex: 0,
  });
  doc = first.document;
  const second = addFrameToPaperPage(doc, pageId, {
    id: 'frame-b',
    kind: 'caption',
    label: 'B',
    xMm: 30,
    yMm: 35,
    widthMm: 42,
    heightMm: 18,
    zIndex: 1,
  });
  doc = second.document;
  const third = addFrameToPaperPage(doc, pageId, {
    id: 'frame-c',
    kind: 'speechBubble',
    label: 'C',
    xMm: 50,
    yMm: 58,
    widthMm: 34,
    heightMm: 24,
    zIndex: 2,
  });
  doc = third.document;
  return { doc, pageId };
}

function frame(doc: ReturnType<typeof createDefaultPaperDocument>, id: string) {
  return doc.pages[0].frames.find((candidate) => candidate.id === id);
}

describe('paperUsabilityActions', () => {
  it('exposes at least 30 concrete right-click usability actions', () => {
    expect(PAPER_FRAME_CONTEXT_ACTIONS.map((action) => action.id)).toEqual(expect.arrayContaining([
      'bring-to-front',
      'send-to-back',
      'duplicate-frame',
      'delete-frame',
      'snap-to-grid',
      'fit-image-cover',
      'convert-to-speech',
      'border-dashed',
      'toggle-gradient-fill',
      'opacity-50',
      'tail-bottom-right',
    ]));
    expect(PAPER_FRAME_CONTEXT_ACTIONS.length + PAPER_PAGE_CONTEXT_ACTIONS.length).toBeGreaterThanOrEqual(30);
  });

  it('reorders frames forward, backward, front, and back using z-index normalization', () => {
    const { doc, pageId } = seededDocument();

    const toFront = applyPaperFrameContextAction(doc, pageId, 'frame-a', 'bring-to-front').document;
    expect(frame(toFront, 'frame-a')?.zIndex).toBe(2);
    expect(frame(toFront, 'frame-c')?.zIndex).toBe(1);

    const backward = applyPaperFrameContextAction(toFront, pageId, 'frame-a', 'send-backward').document;
    expect(frame(backward, 'frame-a')?.zIndex).toBe(1);
    expect(frame(backward, 'frame-c')?.zIndex).toBe(2);

    const toBack = applyPaperFrameContextAction(backward, pageId, 'frame-a', 'send-to-back').document;
    expect(frame(toBack, 'frame-a')?.zIndex).toBe(0);

    const forward = applyPaperFrameContextAction(toBack, pageId, 'frame-a', 'bring-forward').document;
    expect(frame(forward, 'frame-a')?.zIndex).toBe(1);
  });

  it('reorders caption frames with the same stacking actions as image and bubble frames', () => {
    const { doc, pageId } = seededDocument();

    const toFront = applyPaperFrameContextAction(doc, pageId, 'frame-b', 'bring-to-front').document;
    expect(frame(toFront, 'frame-b')?.zIndex).toBe(2);
    expect(frame(toFront, 'frame-c')?.zIndex).toBe(1);

    const backward = applyPaperFrameContextAction(toFront, pageId, 'frame-b', 'send-backward').document;
    expect(frame(backward, 'frame-b')?.zIndex).toBe(1);
    expect(frame(backward, 'frame-c')?.zIndex).toBe(2);

    const toBack = applyPaperFrameContextAction(backward, pageId, 'frame-b', 'send-to-back').document;
    expect(frame(toBack, 'frame-b')?.zIndex).toBe(0);
    expect(frame(toBack, 'frame-a')?.zIndex).toBe(1);

    const forward = applyPaperFrameContextAction(toBack, pageId, 'frame-b', 'bring-forward').document;
    expect(frame(forward, 'frame-b')?.zIndex).toBe(1);
  });

  it('duplicates, deletes, locks, snaps, centers, and fits frames to useful page geometry', () => {
    const { doc, pageId } = seededDocument();

    const duplicated = applyPaperFrameContextAction(doc, pageId, 'frame-b', 'duplicate-frame');
    expect(duplicated.selectedFrameId).toBeDefined();
    expect(duplicated.document.pages[0].frames).toHaveLength(4);
    expect(frame(duplicated.document, duplicated.selectedFrameId!)?.xMm).toBe(34);

    const locked = applyPaperFrameContextAction(duplicated.document, pageId, 'frame-b', 'lock-frame').document;
    expect(frame(locked, 'frame-b')?.locked).toBe(true);
    const unlocked = applyPaperFrameContextAction(locked, pageId, 'frame-b', 'unlock-frame').document;
    expect(frame(unlocked, 'frame-b')?.locked).toBe(false);

    const snapped = applyPaperFrameContextAction(unlocked, pageId, 'frame-a', 'snap-to-grid').document;
    expect(frame(snapped, 'frame-a')).toMatchObject({ xMm: 10, yMm: 15, widthMm: 40, heightMm: 30 });

    const centered = applyPaperFrameContextAction(snapped, pageId, 'frame-a', 'center-on-page').document;
    expect(frame(centered, 'frame-a')?.xMm).toBeCloseTo(87.95);
    expect(frame(centered, 'frame-a')?.yMm).toBeCloseTo(124.7);

    const fitted = applyPaperFrameContextAction(centered, pageId, 'fit-to-margins').document;
    expect(frame(fitted, 'frame-a')).toMatchObject({
      xMm: 12.7,
      yMm: 12.7,
      widthMm: 190.5,
      heightMm: 254,
    });

    const deleted = applyPaperFrameContextAction(fitted, pageId, 'frame-b', 'delete-frame');
    expect(deleted.document.pages[0].frames.some((candidate) => candidate.id === 'frame-b')).toBe(false);
  });

  it('nudges selected frames for arrow-key movement without moving locked frames', () => {
    const { doc, pageId } = seededDocument();

    const nudged = nudgePaperFrame(doc, pageId, 'frame-a', 1, -2).document;
    expect(frame(nudged, 'frame-a')).toMatchObject({ xMm: 13, yMm: 11 });

    const locked = applyPaperFrameContextAction(nudged, pageId, 'frame-a', 'lock-frame').document;
    const unchanged = nudgePaperFrame(locked, pageId, 'frame-a', 5, 5).document;
    expect(frame(unchanged, 'frame-a')).toMatchObject({ xMm: 13, yMm: 11 });
  });

  it('applies image, comic, and text-oriented frame shortcuts', () => {
    const { doc, pageId } = seededDocument();
    const placed = placeSourceAssetInPaperFrame(doc, {
      pageId,
      frameId: 'frame-a',
      item: imageItem(),
    });

    const covered = applyPaperFrameContextAction(placed, pageId, 'frame-a', 'fit-image-cover').document;
    expect(frame(covered, 'frame-a')).toMatchObject({ fit: 'cover' });

    const zoomed = applyPaperFrameContextAction(covered, pageId, 'frame-a', 'image-zoom-in').document;
    expect(frame(zoomed, 'frame-a')?.imageScale).toBeCloseTo(1.1);

    const rotated = applyPaperFrameContextAction(zoomed, pageId, 'frame-a', 'rotate-image-90').document;
    expect(frame(rotated, 'frame-a')?.imageRotationDeg).toBe(90);

    const reset = applyPaperFrameContextAction(rotated, pageId, 'frame-a', 'reset-image-crop').document;
    expect(frame(reset, 'frame-a')).toMatchObject({
      imageScale: 1,
      imageOffsetXPercent: 0,
      imageOffsetYPercent: 0,
      imageRotationDeg: 0,
    });

    const speech = applyPaperFrameContextAction(reset, pageId, 'frame-b', 'convert-to-speech').document;
    expect(frame(speech, 'frame-b')).toMatchObject({
      kind: 'speechBubble',
      bubbleShape: 'organic',
      bubbleTailWidthPercent: 18,
      tailXPercent: 72,
      tailYPercent: 92,
    });

    const styled = applyPaperFrameContextAction(speech, pageId, 'frame-b', 'style-thought-bubble').document;
    expect(frame(styled, 'frame-b')).toMatchObject({
      kind: 'thoughtBubble',
      strokeColor: '#111827',
      fillColor: '#ffffff',
    });

    const tailed = applyPaperFrameContextAction(styled, pageId, 'frame-b', 'tail-bottom-left').document;
    expect(frame(tailed, 'frame-b')).toMatchObject({ tailXPercent: 22, tailYPercent: 92 });
  });

  it('supports richer clay-like speech bubble presets and tail shaping', () => {
    const { doc, pageId } = seededDocument();
    const speech = applyPaperFrameContextAction(doc, pageId, 'frame-b', 'convert-to-speech').document;
    const wideTail = applyPaperFrameContextAction(speech, pageId, 'frame-b', 'bubble-wide-tail').document;
    expect(frame(wideTail, 'frame-b')?.bubbleTailWidthPercent).toBe(24);

    const strongWarp = applyPaperFrameContextAction(wideTail, pageId, 'frame-b', 'bubble-strong-warp').document;
    expect(frame(strongWarp, 'frame-b')?.bubbleWarp).toBeCloseTo(0.26);

    const oval = applyPaperFrameContextAction(strongWarp, pageId, 'frame-b', 'bubble-oval').document;
    expect(frame(oval, 'frame-b')).toMatchObject({
      kind: 'speechBubble',
      bubbleShape: 'oval',
      bubbleWarp: 0,
    });
  });

  it('applies desktop-publishing border, opacity, and gradient frame styling', () => {
    const { doc, pageId } = seededDocument();

    const dashed = applyPaperFrameContextAction(doc, pageId, 'frame-a', 'border-dashed').document;
    expect(frame(dashed, 'frame-a')).toMatchObject({
      strokeStyle: 'dashed',
    });

    const thicker = applyPaperFrameContextAction(dashed, pageId, 'frame-a', 'border-thicker').document;
    expect(frame(thicker, 'frame-a')?.strokeWidthMm).toBeCloseTo(0.45);

    const halfOpacity = applyPaperFrameContextAction(thicker, pageId, 'frame-a', 'opacity-50').document;
    expect(frame(halfOpacity, 'frame-a')).toMatchObject({
      opacity: 0.5,
      fillOpacity: 0.5,
    });

    const gradient = applyPaperFrameContextAction(halfOpacity, pageId, 'frame-a', 'toggle-gradient-fill').document;
    expect(frame(gradient, 'frame-a')?.fillGradient).toMatchObject({
      type: 'linear',
      fromColor: '#67e8f9',
      toColor: '#f9a8d4',
      angleDeg: 135,
    });
  });

  it('adds page-context frames at the right-click point and can place source assets immediately', () => {
    const doc = createDefaultPaperDocument({ title: 'Page Menu' });
    const pageId = doc.pages[0].id;

    const image = applyPaperPageContextAction(doc, pageId, 'add-image-here', {
      point: { xMm: 42, yMm: 51 },
      sourceItem: imageItem('cover'),
    });
    const imageFrame = frame(image.document, image.selectedFrameId!);
    expect(imageFrame).toMatchObject({
      kind: 'image',
      xMm: 42,
      yMm: 51,
      asset: expect.objectContaining({ sourceBinItemId: 'cover' }),
    });

    const caption = applyPaperPageContextAction(image.document, pageId, 'add-caption-here', {
      point: { xMm: 20, yMm: 22 },
      sourceItem: textItem(),
    });
    expect(frame(caption.document, caption.selectedFrameId!)).toMatchObject({
      kind: 'caption',
      text: 'Imported narration.',
    });
  });

  it('creates point-by-point polygon shape frames only after at least three vertices', () => {
    const doc = createDefaultPaperDocument({ title: 'Shape Menu' });
    const pageId = doc.pages[0].id;

    const tooFew = addPaperPolygonShapeFrame(doc, pageId, [
      { xMm: 10, yMm: 10 },
      { xMm: 40, yMm: 12 },
    ]);
    expect(tooFew.document.pages[0].frames).toHaveLength(0);

    const triangle = addPaperPolygonShapeFrame(doc, pageId, [
      { xMm: 10, yMm: 10 },
      { xMm: 40, yMm: 12 },
      { xMm: 24, yMm: 45 },
    ]);
    const shape = frame(triangle.document, triangle.selectedFrameId!);
    expect(shape).toMatchObject({
      kind: 'shape',
      xMm: 10,
      yMm: 10,
      widthMm: 30,
      heightMm: 35,
      strokeStyle: 'solid',
    });
    expect(shape?.vertices).toEqual([
      { xPercent: 0, yPercent: 0 },
      { xPercent: 100, yPercent: expect.closeTo(5.714, 3) },
      { xPercent: expect.closeTo(46.667, 3), yPercent: 100 },
    ]);
  });

  it('splits a panel frame vertically with gutter spacing', () => {
    const doc = createDefaultPaperDocument({ title: 'Gutter Knife Test' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, {
      kind: 'panel',
      label: 'Main Panel',
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 100,
      fillColor: '#ffffff',
      strokeColor: '#000000',
    });

    const testDoc = {
      ...added.document,
      layout: {
        ...added.document.layout,
        columns: {
          count: 2,
          gutterMm: 10,
        },
      },
    };

    const result = splitPaperPanelFrame(
      testDoc,
      pageId,
      { xMm: 60, yMm: 0 },
      { xMm: 60, yMm: 120 }
    );

    const pageFrames = result.document.pages[0].frames;
    expect(pageFrames).toHaveLength(2);

    const sorted = [...pageFrames].sort((a, b) => a.xMm - b.xMm);
    const [left, right] = sorted;

    expect(left.xMm).toBeCloseTo(10);
    expect(left.widthMm).toBeCloseTo(45);
    expect(left.heightMm).toBeCloseTo(100);

    expect(right.xMm).toBeCloseTo(65);
    expect(right.widthMm).toBeCloseTo(45);
    expect(right.heightMm).toBeCloseTo(100);

    expect(left.fillColor).toBe('#ffffff');
    expect(left.strokeColor).toBe('#000000');
    expect(right.fillColor).toBe('#ffffff');
  });

  it('splits a panel frame horizontally', () => {
    const doc = createDefaultPaperDocument({ title: 'Gutter Knife Test 2' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, {
      kind: 'panel',
      label: 'Main Panel',
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 100,
    });

    const testDoc = {
      ...added.document,
      layout: {
        ...added.document.layout,
        columns: {
          count: 2,
          gutterMm: 10,
        },
      },
    };

    const resH = splitPaperPanelFrame(
      testDoc,
      pageId,
      { xMm: 0, yMm: 60 },
      { xMm: 120, yMm: 60 }
    );

    const sortedH = [...resH.document.pages[0].frames].sort((a, b) => a.yMm - b.yMm);
    const [top, bottom] = sortedH;

    expect(top.yMm).toBeCloseTo(10);
    expect(top.heightMm).toBeCloseTo(45);
    expect(bottom.yMm).toBeCloseTo(65);
    expect(bottom.heightMm).toBeCloseTo(45);
  });
});
