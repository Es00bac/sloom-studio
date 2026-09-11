import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { PaperBubbleConnectorControls } from './PaperBubbleConnectorControls';

describe('PaperBubbleConnectorControls', () => {
  it('makes the organic compound connector geometry discoverable from either linked bubble', () => {
    let document = createDefaultPaperDocument({ title: 'Compound controls' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'bubble-a', kind: 'speechBubble', xMm: 10, yMm: 20, widthMm: 34, heightMm: 20,
      bubbleChainId: 'same-speaker', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'bubble-b', kind: 'speechBubble', xMm: 60, yMm: 28, widthMm: 34, heightMm: 20,
      bubbleChainId: 'same-speaker', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge',
    }).document;
    const frames = document.pages[0].frames;

    const html = renderToStaticMarkup(
      <PaperBubbleConnectorControls
        frame={frames[0]}
        onUpdate={() => undefined}
        pageFrames={frames}
      />,
    );

    expect(html).toContain('data-paper-bubble-connector-controls="true"');
    expect(html).toContain('Compound connector shape');
    expect(html).toContain('Bézier');
    expect(html).toContain('Width (mm)');
    expect(html).toContain('First attach (°)');
    expect(html).toContain('Curve 2 (%)');
  });
});
