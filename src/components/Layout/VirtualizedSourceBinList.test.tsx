import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VirtualizedSourceBinList } from './VirtualizedSourceBinList';

const items = Array.from({ length: 10 }, (_, index) => ({
  id: `item-${index + 1}`,
  label: `Item ${index + 1}`,
  kind: 'image' as const,
  createdAt: index + 1,
}));

describe('VirtualizedSourceBinList', () => {
  it('renders only the visible rows plus overscan on the initial window', () => {
    const markup = renderToStaticMarkup(
      <VirtualizedSourceBinList
        initialHeight={80}
        items={items}
        overscan={1}
        rowHeight={40}
        renderRow={(item) => <span>{item.label}</span>}
      />,
    );

    expect(markup).toContain('Item 1');
    expect(markup).toContain('Item 2');
    expect(markup).toContain('Item 3');
    expect(markup).not.toContain('Item 4');
    expect(markup).not.toContain('Item 5');
    expect(markup.match(/data-source-bin-virtual-row=/g)?.length ?? 0).toBe(3);
  });

  it('can start from a later scroll window without rendering the full list', () => {
    const markup = renderToStaticMarkup(
      <VirtualizedSourceBinList
        initialHeight={80}
        initialScrollTop={120}
        items={items}
        overscan={1}
        rowHeight={40}
        renderRow={(item) => <span>{item.label}</span>}
      />,
    );

    expect(markup).not.toContain('Item 1');
    expect(markup).toContain('Item 3');
    expect(markup).toContain('Item 4');
    expect(markup).toContain('Item 6');
    expect(markup).not.toContain('Item 8');
    expect(markup.match(/data-source-bin-virtual-row=/g)?.length ?? 0).toBe(4);
  });

  it('supports variable row heights for mixed header and card rows', () => {
    const markup = renderToStaticMarkup(
      <VirtualizedSourceBinList
        getItemHeight={(item) => (item.id === 'item-2' ? 80 : 20)}
        initialHeight={60}
        items={items}
        overscan={0}
        rowHeight={20}
        renderRow={(item) => <span>{item.label}</span>}
      />,
    );

    expect(markup).toContain('Item 1');
    expect(markup).toContain('Item 2');
    expect(markup).not.toContain('Item 3');
    expect(markup.match(/data-source-bin-virtual-row=/g)?.length ?? 0).toBe(2);
  });
});
