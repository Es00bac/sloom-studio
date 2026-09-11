import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BottomToolbar } from './BottomToolbar';

describe('BottomToolbar topbar presentation', () => {
  it('renders the top Flow node toolbar as categorized menus instead of one long flat strip', () => {
    const html = renderToStaticMarkup(<BottomToolbar onAddNode={() => undefined} variant="topbar" />);

    expect(html).toContain('data-toolbar-variant="topbar"');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).toContain('data-node-category-menu="true"');
    expect(html).toContain('Flow Control');
    expect(html).toContain('Stop When');
    expect(html).toContain('Value');
    expect(html).toContain('Color Palette');
    expect(html).toContain('Crop Image');
  });

  it('shows compact topbar category labels on standard monitors (>=1600px), icon-only below', () => {
    const html = renderToStaticMarkup(<BottomToolbar onAddNode={() => undefined} variant="topbar" />);

    expect(html).toContain('hidden min-[1600px]:inline');
    expect(html).not.toContain('hidden xl:inline');
    expect(html).not.toContain('hidden 2xl:inline');
  });

  it('surfaces provider-specific Image node templates from the toolbar', () => {
    const html = renderToStaticMarkup(<BottomToolbar onAddNode={() => undefined} variant="topbar" />);

    expect(html).toContain('data-image-provider-menu="true"');
    expect(html).toContain('Add FLUX.2 Multi-Reference image node');
    expect(html).toContain('Add Stability Inpaint image node');
    expect(html).toContain('Add Local/Open Qwen Edit image node');
  });

  it('documents each catalog node without nesting help controls inside its add button', () => {
    const html = renderToStaticMarkup(<BottomToolbar onAddNode={() => undefined} variant="topbar" />);

    expect(html).toContain('Connections &amp; example');
    expect(html).toContain('Crop one connected image locally and emit the cropped pixels.');
    expect(html).toMatch(/<button[^>]*aria-label="Add Crop Image node"[^>]*>[\s\S]*?<\/button>[\s\S]*?<details/);
    const cropButton = html.match(/(<button aria-label="Add Crop Image node"[\s\S]*?<\/button>)/)?.[1];
    expect(cropButton).toBeDefined();
    expect(cropButton).not.toContain('<details');
  });
});

describe('BottomToolbar starter-template menu (MH-094)', () => {
  it('renders a leading Start menu with the gallery only when template insertion is provided', () => {
    const withGallery = renderToStaticMarkup(
      <BottomToolbar onAddNode={() => undefined} onInsertStarterTemplate={() => undefined} variant="topbar" />,
    );
    expect(withGallery).toContain('data-starter-template-menu="true"');
    expect(withGallery).toContain('aria-label="Open Flow starter templates"');
    expect(withGallery).toContain('data-starter-template-menu-panel="true"');
    expect(withGallery).toContain('data-starter-template-card="text-to-image"');
    // The menu renders before the node categories.
    expect(withGallery.indexOf('data-starter-template-menu')).toBeLessThan(withGallery.indexOf('data-node-category-menu'));

    const withoutGallery = renderToStaticMarkup(<BottomToolbar onAddNode={() => undefined} variant="topbar" />);
    expect(withoutGallery).not.toContain('data-starter-template-menu');
    expect(withoutGallery).toContain('data-node-category-menu="true"');
  });

  it('anchors the compact Start popover to the trigger\'s left edge instead of centering it (Faye Rowan P1: off-screen at 800x600)', () => {
    const html = renderToStaticMarkup(
      <BottomToolbar onAddNode={() => undefined} onInsertStarterTemplate={() => undefined} variant="topbar" />,
    );
    // A centered `left-1/2 -translate-x-1/2` popover on a trigger near a narrow viewport's
    // edge hangs off-screen (measured -149px at 800x600). Left-anchoring the popover to the
    // trigger, the same way the non-compact floating/dockable variant already does, keeps it
    // on-screen without needing a viewport-width-dependent calculation.
    const menuMatch = html.match(/<div class="([^"]*\bw-96\b[^"]*)"/);
    expect(menuMatch).not.toBeNull();
    const menuClassName = menuMatch![1];
    expect(menuClassName).toContain('left-0');
    expect(menuClassName).not.toContain('left-1/2');
    expect(menuClassName).not.toContain('-translate-x-1/2');
    // Faye also measured it running 18px past the viewport bottom at 800x600 (y 96..618) —
    // the popover needs its own height cap and scroll, not just the inner list's.
    expect(menuClassName).toContain('max-h-[calc(100vh-3rem)]');
    expect(menuClassName).toContain('overflow-y-auto');
  });

  it('marks the Start menu details as a keyboard-focus scope so Tab traverses instead of hiding the interface', () => {
    const html = renderToStaticMarkup(
      <BottomToolbar onAddNode={() => undefined} onInsertStarterTemplate={() => undefined} variant="topbar" />,
    );
    expect(html).toMatch(/<details[^>]*data-keyboard-focus-scope="true"[^>]*data-starter-template-menu="true"/);
  });
});

describe('BottomToolbar node-pack import entry (MH-097)', () => {
  it('offers node-pack import inside the Start menu only when import is available', () => {
    const withImport = renderToStaticMarkup(
      <BottomToolbar
        onAddNode={() => undefined}
        onImportNodePack={() => undefined}
        onInsertStarterTemplate={() => undefined}
        variant="topbar"
      />,
    );
    expect(withImport).toContain('data-import-node-pack="true"');
    expect(withImport).toContain('Import node pack…');
    expect(withImport).toContain('shared .sloompack file');

    const withoutImport = renderToStaticMarkup(
      <BottomToolbar onAddNode={() => undefined} onInsertStarterTemplate={() => undefined} variant="topbar" />,
    );
    expect(withoutImport).not.toContain('data-import-node-pack');
  });
});
