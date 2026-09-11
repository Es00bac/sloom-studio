import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedContextMenu } from './SharedContextMenu';

describe('SharedContextMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('positions expanded submenu groups fully inside the viewport near the bottom edge', () => {
    vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768 });

    const html = renderToStaticMarkup(
      <SharedContextMenu
        items={[
          {
            id: 'stacking',
            label: 'Stacking',
            children: Array.from({ length: 30 }, (_, index) => ({
              id: `stacking-${index}`,
              label: `Stacking action ${index + 1}`,
              action: () => undefined,
            })),
          },
        ]}
        x={920}
        y={740}
      />,
    );

    expect(html).toContain('max-height:744px');
    expect(html).toContain('top:12px');
    expect(html).not.toContain('top:654px');
  });

  it('clamps a tall menu away from the right edge and keeps it scrollable', () => {
    vi.stubGlobal('window', { innerWidth: 320, innerHeight: 240 });

    const html = renderToStaticMarkup(
      <SharedContextMenu
        items={Array.from({ length: 20 }, (_, index) => ({
          id: `item-${index}`,
          label: `Action ${index + 1}`,
          action: () => undefined,
        }))}
        x={318}
        y={200}
      />,
    );

    expect(html).toContain('left:52px');
    expect(html).toContain('top:12px');
    expect(html).toContain('max-height:216px');
    expect(html).toContain('max-height:182px');
    expect(html).toContain('overflow-y:auto');
  });

  it('renders submenu groups without flattening large menus into one column', () => {
    const html = renderToStaticMarkup(
      <SharedContextMenu
        items={[
          {
            id: 'flow-control',
            label: 'Flow Control',
            children: [
              { id: 'loop', label: 'Loop', action: () => undefined },
              { id: 'break', label: 'Stop When', action: () => undefined },
            ],
          },
        ]}
        x={10}
        y={10}
      />,
    );

    expect(html).toContain('Flow Control');
    expect(html).toContain('Stop When');
    expect(html).toContain('data-context-submenu="true"');
    expect(html).toContain('overflow-y-auto');
  });

  it('shrinks the menu inside narrow viewports instead of rendering off-screen', () => {
    vi.stubGlobal('window', { innerWidth: 240, innerHeight: 180 });

    const html = renderToStaticMarkup(
      <SharedContextMenu
        items={Array.from({ length: 20 }, (_, index) => ({
          id: `item-${index}`,
          label: `Action ${index + 1}`,
          action: () => undefined,
        }))}
        x={230}
        y={170}
      />,
    );

    expect(html).toContain('left:12px');
    expect(html).toContain('top:12px');
    expect(html).toContain('max-height:156px');
    expect(html).toContain('width:216px');
    expect(html).not.toContain('width:256px');
  });
});
