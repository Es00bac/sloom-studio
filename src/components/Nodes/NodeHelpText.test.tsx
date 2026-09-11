// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NodeHelpText,
  isNodeHelpExpanded,
  readNodeHelpExpandedState,
  writeNodeHelpExpanded,
} from './NodeHelpText';

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  vi.stubGlobal('localStorage', stub);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: stub });
}

describe('NodeHelpText persistence', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('defaults to collapsed when no preference is stored', () => {
    expect(isNodeHelpExpanded('loopNode')).toBe(false);
    expect(readNodeHelpExpandedState()).toEqual({});
  });

  it('persists the expanded/collapsed choice per help key', () => {
    writeNodeHelpExpanded('loopNode', true);
    expect(isNodeHelpExpanded('loopNode')).toBe(true);
    // Other keys stay at their default.
    expect(isNodeHelpExpanded('regexParseNode')).toBe(false);

    writeNodeHelpExpanded('loopNode', false);
    expect(isNodeHelpExpanded('loopNode')).toBe(false);
  });

  it('ignores malformed stored state', () => {
    window.localStorage.setItem('signal-loom:flow:node-help-expanded', '{not json');
    expect(readNodeHelpExpandedState()).toEqual({});
    expect(isNodeHelpExpanded('loopNode', true)).toBe(true);
  });
});

describe('NodeHelpText rendering', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the compact dismissible affordance by default instead of the full prose', () => {
    const html = renderToStaticMarkup(
      <NodeHelpText helpKey="loopNode" summary="Repeats the upstream item 5x">
        Repeats the upstream connected item into a loop list and runs generation batches.
      </NodeHelpText>,
    );

    expect(html).toContain('aria-label="Show node help"');
    expect(html).toContain('data-node-help-state="collapsed"');
    expect(html).toContain('Repeats the upstream item 5x');
    // The full multi-line prose stays hidden until the user expands.
    expect(html).not.toContain('runs generation batches');
  });

  it('renders the full help with a hide control when the key is persisted as expanded', () => {
    writeNodeHelpExpanded('loopNode', true);

    const html = renderToStaticMarkup(
      <NodeHelpText helpKey="loopNode" summary="Repeats the upstream item 5x">
        Repeats the upstream connected item into a loop list and runs generation batches.
      </NodeHelpText>,
    );

    expect(html).toContain('aria-label="Hide node help"');
    expect(html).toContain('data-node-help-state="expanded"');
    expect(html).toContain('runs generation batches');
  });
});
