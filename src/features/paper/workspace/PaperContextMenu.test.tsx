import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { PaperContextMenu } from './PaperWorkspace';

const noop = () => {};

describe('PaperContextMenu', () => {
  const bubbleFrame = (() => {
    const document = createDefaultPaperDocument({ title: 'Bubble menu' });
    return addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'speechBubble',
      label: 'Speaker bubble',
      xMm: 12,
      yMm: 24,
      widthMm: 30,
      heightMm: 18,
    }).document.pages[0].frames[0];
  })();
  const blankImageFrame = (() => {
    const document = createDefaultPaperDocument({ title: 'Hane menu' });
    return addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image',
      label: 'Blank panel art',
      xMm: 12,
      yMm: 24,
      widthMm: 80,
      heightMm: 60,
    }).document.pages[0].frames[0];
  })();

  it('renders with a viewport-bounded max height so every item remains reachable near screen edges', () => {
    const html = renderToStaticMarkup(
      <PaperContextMenu
        context={{ x: 900, y: 740, pageId: 'page-1', point: { xMm: 10, yMm: 10 } }}
        hasStyleClipboard={false}
        onAddComicSfx={noop}
        onApplyFrameAction={noop}
        onApplyPageAction={noop}
        onChainSelectedBubbles={noop}
        onClose={noop}
        onCopyFrameStyle={noop}
        onEditComicSfxFrame={noop}
        onOpenImageFrame={noop}
        onOpenImageFrameInHane={noop}
        onFitFrameToText={noop}
        onPasteFrameStyle={noop}
        onPlaceSourceInFrame={noop}
        onQuickEditImageFrame={noop}
        onAiFixImageFrame={noop}
        onSendFrameSourceToFlow={noop}
        onSendFrameSourceToVideo={noop}
        onSendPageToSourceLibrary={noop}
        onSendAllPagesToSourceLibrary={noop}
        onUnchainSelectedBubbles={noop}
        onThreadSelectedFrames={noop}
        onUnthreadSelectedFrames={noop}
        onAlignSelectedFrames={noop}
        onDistributeSelectedFrames={noop}
        onUpscaleFrameForPrint={noop}
        selectedBubbleCount={0}
        selectedTextFrameCount={0}
        selectedFrameCount={0}
        sourceItems={[]}
      />,
    );

    expect(html).toContain('data-paper-context-menu="true"');
    expect(html).toContain('max-height:744px');
    expect(html).not.toContain('max-h-[72vh]');
  });

  it('offers page-level Send to Source Library commands so a whole page composition can be reused as an Image/Video/Flow asset', () => {
    const html = renderToStaticMarkup(
      <PaperContextMenu
        context={{ x: 400, y: 300, pageId: 'page-1', point: { xMm: 10, yMm: 10 } }}
        hasStyleClipboard={false}
        onAddComicSfx={noop}
        onApplyFrameAction={noop}
        onApplyPageAction={noop}
        onChainSelectedBubbles={noop}
        onClose={noop}
        onCopyFrameStyle={noop}
        onEditComicSfxFrame={noop}
        onOpenImageFrame={noop}
        onOpenImageFrameInHane={noop}
        onFitFrameToText={noop}
        onPasteFrameStyle={noop}
        onPlaceSourceInFrame={noop}
        onQuickEditImageFrame={noop}
        onAiFixImageFrame={noop}
        onSendFrameSourceToFlow={noop}
        onSendFrameSourceToVideo={noop}
        onSendPageToSourceLibrary={noop}
        onSendAllPagesToSourceLibrary={noop}
        onUnchainSelectedBubbles={noop}
        onThreadSelectedFrames={noop}
        onUnthreadSelectedFrames={noop}
        onAlignSelectedFrames={noop}
        onDistributeSelectedFrames={noop}
        onUpscaleFrameForPrint={noop}
        selectedBubbleCount={0}
        selectedTextFrameCount={0}
        selectedFrameCount={0}
        sourceItems={[]}
      />,
    );

    expect(html).toContain('Send This Page to Source Library');
    expect(html).toContain('Send All Pages to Source Library');
  });

  it('keeps bubble-chain actions visible with selection guidance until two bubbles are selected', () => {
    const html = renderToStaticMarkup(
      <PaperContextMenu
        context={{ x: 400, y: 300, pageId: 'page-1', frameId: bubbleFrame.id, point: { xMm: 10, yMm: 10 } }}
        frame={bubbleFrame}
        hasStyleClipboard={false}
        onAddComicSfx={noop}
        onApplyFrameAction={noop}
        onApplyPageAction={noop}
        onChainSelectedBubbles={noop}
        onClose={noop}
        onCopyFrameStyle={noop}
        onEditComicSfxFrame={noop}
        onOpenImageFrame={noop}
        onOpenImageFrameInHane={noop}
        onFitFrameToText={noop}
        onPasteFrameStyle={noop}
        onPlaceSourceInFrame={noop}
        onQuickEditImageFrame={noop}
        onAiFixImageFrame={noop}
        onSendFrameSourceToFlow={noop}
        onSendFrameSourceToVideo={noop}
        onSendPageToSourceLibrary={noop}
        onSendAllPagesToSourceLibrary={noop}
        onUnchainSelectedBubbles={noop}
        onThreadSelectedFrames={noop}
        onUnthreadSelectedFrames={noop}
        onAlignSelectedFrames={noop}
        onDistributeSelectedFrames={noop}
        onUpscaleFrameForPrint={noop}
        selectedBubbleCount={1}
        selectedTextFrameCount={0}
        selectedFrameCount={1}
        sourceItems={[]}
      />,
    );

    expect(html).toContain('Bubble Chain');
    expect(html).toContain('Select at least 2 bubbles with Ctrl/Cmd-click');
    expect(html).toContain('Same Speaker — Merge 1 Bubbles');
    expect(html).toContain('disabled=""');
  });

  it('disables visible bubble-chain mutations when the selected chain is layer-locked', () => {
    const html = renderToStaticMarkup(
      <PaperContextMenu
        bubbleChainActionsDisabled
        context={{ x: 400, y: 300, pageId: 'page-1', frameId: bubbleFrame.id, point: { xMm: 10, yMm: 10 } }}
        frame={{ ...bubbleFrame, bubbleChainId: 'chain-1' }}
        hasStyleClipboard={false}
        onAddComicSfx={noop}
        onApplyFrameAction={noop}
        onApplyPageAction={noop}
        onChainSelectedBubbles={noop}
        onClose={noop}
        onCopyFrameStyle={noop}
        onEditComicSfxFrame={noop}
        onOpenImageFrame={noop}
        onOpenImageFrameInHane={noop}
        onFitFrameToText={noop}
        onPasteFrameStyle={noop}
        onPlaceSourceInFrame={noop}
        onQuickEditImageFrame={noop}
        onAiFixImageFrame={noop}
        onSendFrameSourceToFlow={noop}
        onSendFrameSourceToVideo={noop}
        onSendPageToSourceLibrary={noop}
        onSendAllPagesToSourceLibrary={noop}
        onUnchainSelectedBubbles={noop}
        onThreadSelectedFrames={noop}
        onUnthreadSelectedFrames={noop}
        onAlignSelectedFrames={noop}
        onDistributeSelectedFrames={noop}
        onUpscaleFrameForPrint={noop}
        selectedBubbleCount={2}
        selectedTextFrameCount={0}
        selectedFrameCount={2}
        sourceItems={[]}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Same Speaker — Merge 2 Bubbles<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Unchain Selected Bubbles<\/button>/);
  });

  it('offers Hane Mobile for a blank image frame and exposes the live-stop state', () => {
    const renderMenu = (linked: boolean) => renderToStaticMarkup(
      <PaperContextMenu
        context={{
          x: 400,
          y: 300,
          pageId: 'page-1',
          frameId: blankImageFrame.id,
          point: { xMm: 10, yMm: 10 },
        }}
        frame={blankImageFrame}
        haneLinkedEditTarget={linked
          ? { pageId: 'page-1', frameId: blankImageFrame.id }
          : null}
        hasStyleClipboard={false}
        onAddComicSfx={noop}
        onApplyFrameAction={noop}
        onApplyPageAction={noop}
        onChainSelectedBubbles={noop}
        onClose={noop}
        onCopyFrameStyle={noop}
        onEditComicSfxFrame={noop}
        onOpenImageFrame={noop}
        onOpenImageFrameInHane={noop}
        onFitFrameToText={noop}
        onPasteFrameStyle={noop}
        onPlaceSourceInFrame={noop}
        onQuickEditImageFrame={noop}
        onAiFixImageFrame={noop}
        onSendFrameSourceToFlow={noop}
        onSendFrameSourceToVideo={noop}
        onSendPageToSourceLibrary={noop}
        onSendAllPagesToSourceLibrary={noop}
        onUnchainSelectedBubbles={noop}
        onThreadSelectedFrames={noop}
        onUnthreadSelectedFrames={noop}
        onAlignSelectedFrames={noop}
        onDistributeSelectedFrames={noop}
        onUpscaleFrameForPrint={noop}
        selectedBubbleCount={0}
        selectedTextFrameCount={0}
        selectedFrameCount={1}
        sourceItems={[]}
      />,
    );

    expect(renderMenu(false)).toContain('Open Image in Hane Mobile');
    expect(renderMenu(true)).toContain('Stop Hane Live Edit');
  });
});
