import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  resolvePaperPageFramesForCanvas,
} from '../../../lib/paperDocument';
import type { PaperBubbleConnectorStyle } from '../../../types/paper';
import { PaperBubbleConnectorsOverlay } from './PaperBubbleConnectorsOverlay';

function renderConnector(style: PaperBubbleConnectorStyle, editable = false): string {
  let document = createDefaultPaperDocument({ title: 'Bubble Connector Overlay' });
  const pageId = document.pages[0].id;
  document = addFrameToPaperPage(document, pageId, {
    id: 'panel-art',
    kind: 'image',
    xMm: 0,
    yMm: 0,
    widthMm: document.page.widthMm,
    heightMm: document.page.heightMm,
    zIndex: 0,
  }).document;
  document = addFrameToPaperPage(document, pageId, {
    id: 'bubble-a',
    kind: 'speechBubble',
    xMm: 20,
    yMm: 28,
    widthMm: 44,
    heightMm: 24,
    fillColor: '#fef3c7',
    strokeWidthMm: 0.7,
    bubbleChainId: 'visible-chain',
    bubbleChainOrder: 1,
    bubbleConnectorStyle: style,
    zIndex: 1,
  }).document;
  document = addFrameToPaperPage(document, pageId, {
    id: 'bubble-b',
    kind: 'speechBubble',
    xMm: 84,
    yMm: 36,
    widthMm: 44,
    heightMm: 24,
    bubbleChainId: 'visible-chain',
    bubbleChainOrder: 2,
    bubbleConnectorStyle: style,
    zIndex: 2,
  }).document;
  const page = document.pages[0];

  return renderToStaticMarkup(
    <PaperBubbleConnectorsOverlay
      frames={resolvePaperPageFramesForCanvas(document, page)}
      pageHeightMm={document.page.heightMm}
      pageOriginXPx={0}
      pageOriginYPx={0}
      pageWidthMm={document.page.widthMm}
      selectedFrameIds={editable ? ['bubble-a'] : []}
      onBeginConnectorHandle={editable ? () => undefined : undefined}
      zoom={1}
    />,
  );
}

describe('PaperBubbleConnectorsOverlay', () => {
  it('renders a filled bridge in the bubble-relative layer above preceding page art', () => {
    const markup = renderConnector('bridge');

    expect(markup).toContain('data-paper-bubble-connectors="true"');
    expect(markup).toContain('data-paper-canvas-z-index="101"');
    expect(markup).toContain('data-paper-bubble-compound-id=');
    expect(markup).toContain('data-paper-bubble-compound-members="bubble-a bubble-b"');
    expect(markup).toContain('<path');
    expect(markup).toContain('fill="#fef3c7"');
    expect((markup.match(/data-paper-bubble-compound-id=/g) ?? [])).toHaveLength(1);
  });

  it('renders line strokes in document units so they scale with the page zoom', () => {
    const markup = renderConnector('line');

    expect(markup).toContain('<line');
    expect(markup).toContain('data-paper-bubble-connector-style="line"');
    expect(markup).toContain('stroke-width="0.7"');
    expect(markup).not.toContain('vector-effect="non-scaling-stroke"');
  });

  it('exposes both attachments, two Bézier controls, and a width handle when a linked bubble is selected', () => {
    const markup = renderConnector('bridge', true);

    expect(markup).toContain('data-paper-bubble-connector-handles="true"');
    expect(markup).toContain('data-paper-bubble-connector-handle="from-anchor"');
    expect(markup).toContain('data-paper-bubble-connector-handle="to-anchor"');
    expect(markup).toContain('data-paper-bubble-connector-handle="control-1"');
    expect(markup).toContain('data-paper-bubble-connector-handle="control-2"');
    expect(markup).toContain('data-paper-bubble-connector-handle="width"');
  });
});
