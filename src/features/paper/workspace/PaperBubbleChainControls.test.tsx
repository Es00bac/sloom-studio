import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { PaperBubbleChainControls } from './PaperBubbleChainControls';

const noop = () => {};

describe('PaperBubbleChainControls', () => {
  it('shows a target picker and the actual ordered members without exposing raw chain IDs', () => {
    let document = createDefaultPaperDocument({ title: 'Bubble controls' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'bubble-a',
      kind: 'speechBubble',
      label: 'First line',
      xMm: 12,
      yMm: 24,
      widthMm: 30,
      heightMm: 18,
      bubbleChainId: 'opaque-runtime-id',
      bubbleChainOrder: 2,
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'bubble-b',
      kind: 'speechBubble',
      label: 'Opening line',
      xMm: 48,
      yMm: 24,
      widthMm: 30,
      heightMm: 18,
      bubbleChainId: 'opaque-runtime-id',
      bubbleChainOrder: 1,
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'bubble-c',
      kind: 'thoughtBubble',
      label: 'Other bubble',
      xMm: 84,
      yMm: 24,
      widthMm: 30,
      heightMm: 18,
    }).document;
    const frames = document.pages[0].frames;

    const html = renderToStaticMarkup(
      <PaperBubbleChainControls
        document={document}
        frame={frames[0]}
        onChainWith={noop}
        onMove={noop}
        onUnchain={noop}
        pageFrames={frames}
      />,
    );

    expect(html).toContain('Chain to another bubble…');
    expect(html).toContain('Opening line');
    expect(html.indexOf('Opening line')).toBeLessThan(html.indexOf('First line'));
    expect(html).toContain('2 bubbles in this chain');
    expect(html).not.toContain('opaque-runtime-id');
  });

  it('disables chain editing when the selected bubble belongs to a locked layer', () => {
    let document = createDefaultPaperDocument({ title: 'Locked bubble controls' });
    const lockedLayerId = document.layers[0].id;
    document = {
      ...document,
      layers: document.layers.map((layer) => ({ ...layer, locked: true })),
    };
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'locked-bubble', kind: 'speechBubble', layerId: lockedLayerId,
      xMm: 10, yMm: 10, widthMm: 30, heightMm: 20,
    }).document;
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'other-bubble', kind: 'speechBubble', layerId: lockedLayerId,
      xMm: 50, yMm: 10, widthMm: 30, heightMm: 20,
    }).document;

    const html = renderToStaticMarkup(
      <PaperBubbleChainControls
        document={document}
        frame={document.pages[0].frames[0]}
        onChainWith={noop}
        onMove={noop}
        onUnchain={noop}
        pageFrames={document.pages[0].frames}
      />,
    );

    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('<option value="other-bubble"');
  });
});
