// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { prepareExternalPanelDocument } from './DockablePanel';

/**
 * Regression: when a dockable panel pops out into an external window, the panel's
 * document is created via window.open('') and starts life as about:blank. Cloning
 * the app's <link rel="stylesheet"> nodes verbatim copied their relative hrefs
 * (e.g. production builds emit href="./assets/index-*.css"), which resolve against
 * about:blank and silently fail to load — leaving the popped-out panel completely
 * unstyled. prepareExternalPanelDocument must rewrite those links to absolute URLs.
 */
describe('prepareExternalPanelDocument', () => {
  const injected: Element[] = [];

  afterEach(() => {
    for (const node of injected.splice(0)) {
      node.remove();
    }
  });

  function injectIntoMainDocument(html: string): Element {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const node = template.content.firstElementChild as Element;
    document.head.append(node);
    injected.push(node);
    return node;
  }

  function createTargetDocument(): Document {
    return document.implementation.createHTMLDocument('popout');
  }

  it('rewrites relative stylesheet links to absolute URLs in the external document', () => {
    injectIntoMainDocument('<link rel="stylesheet" href="./assets/index-test.css" />');

    const target = createTargetDocument();
    prepareExternalPanelDocument(target);

    const copiedLink = target.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
    expect(copiedLink).not.toBeNull();

    const href = copiedLink!.getAttribute('href') ?? '';
    expect(href).not.toMatch(/^\.?\//); // not "./assets/..." or "/assets/..."
    expect(href).toMatch(/^https?:\/\//); // absolute, will load against the app origin
    expect(href.endsWith('/assets/index-test.css')).toBe(true);
  });

  it('copies inline <style> nodes and marks them so re-runs are idempotent', () => {
    injectIntoMainDocument('<style data-test-style="true">.x{color:red}</style>');

    const target = createTargetDocument();
    prepareExternalPanelDocument(target);
    expect(target.getElementById('signal-loom-floating-panel-style-copy')).not.toBeNull();
    const firstCount = target.querySelectorAll('style').length;

    // Second call must early-return (guarded by the marker) and not duplicate styles.
    prepareExternalPanelDocument(target);
    expect(target.querySelectorAll('style').length).toBe(firstCount);
  });
});
