import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { addPaperPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { PaperPagesPanel } from './PaperPagesPanel';

describe('PaperPagesPanel', () => {
  it('renders navigable thumbnails and page/viewport actions', () => {
    const document = addPaperPage(createDefaultPaperDocument({ title: 'Chapter' }));
    const html = renderToStaticMarkup(
      <PaperPagesPanel
        document={document}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onFitPage={vi.fn()}
        onFitSpread={vi.fn()}
        onSelectPage={vi.fn()}
        selectedPageId={document.pages[1].id}
      />,
    );

    expect(html.match(/data-paper-page-thumbnail=/g)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Fit page');
    expect(html).toContain('Fit spread');
    expect(html).toContain('Add page');
    expect(html).toContain('Duplicate');
  });
});
