// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileInterfaceStore } from '../../../store/mobileInterfaceStore';
import { PaperWorkspace } from './PaperWorkspace';

vi.mock('../../../lib/mobilePhoneInterface', () => ({
  useMobilePhoneInterfaceDescriptor: () => ({
    enabled: true,
    orientation: 'portrait',
    surface: 'phone',
    topbarHeightPx: 48,
    expandedDrawerMaxHeightCss: 'min(72vh, 34rem)',
    collapsedTopPaddingClassName: 'pt-12',
    hiddenTopPaddingClassName: 'pt-0',
    reason: 'test-phone',
  }),
}));

vi.mock('../../../components/Layout/FlowSourceBinSidebar', () => ({
  FlowSourceBinSidebar: ({ embeddedDrawer }: { embeddedDrawer?: boolean }) => (
    <div data-embedded-drawer={embeddedDrawer ? 'true' : 'false'} data-testid="paper-mobile-source-bin">
      Source Library
    </div>
  ),
}));

vi.mock('../../../components/DockablePanel', () => ({
  DockablePanelHost: ({ children }: { children: ReactNode }) => (
    <div data-testid="paper-desktop-dock-host">{children}</div>
  ),
}));

vi.mock('../../../shared/native/useNativeMenuCommand', () => ({
  useNativeMenuCommand: () => undefined,
}));

vi.mock('../../../lib/paperTopbarSlot', () => ({
  observePaperTopbarSlot: () => () => undefined,
}));

describe('PaperWorkspace mobile shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useMobileInterfaceStore.setState({
      activeEdgeDrawer: null,
      chromeMode: 'collapsed',
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses Paper phone edge drawers instead of the desktop dock host on phones', () => {
    act(() => {
      root.render(<PaperWorkspace />);
    });

    const phoneShell = container.querySelector('[data-paper-mobile-edge-shell="true"]');
    expect(phoneShell).not.toBeNull();
    expect(phoneShell?.className).toContain('h-full');
    expect(container.querySelector('[data-testid="paper-desktop-dock-host"]')).toBeNull();
    expect(document.body.querySelector('[data-paper-mobile-edge-overlay="viewport"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Open Paper Source Library drawer"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Open Paper panels drawer"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Open Paper assets drawer"]')).not.toBeNull();

    act(() => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Paper panels drawer"]')?.click();
    });
    expect(document.body.querySelector('[data-paper-mobile-edge-drawer="panels"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Inspector');
    expect(document.body.textContent).toContain('Preflight');

    act(() => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Paper Source Library drawer"]')?.click();
    });
    expect(document.body.querySelector('[data-paper-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(document.body.querySelector('[data-paper-mobile-edge-drawer="panels"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="paper-mobile-source-bin"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="paper-mobile-source-bin"]')?.getAttribute('data-embedded-drawer')).toBe('true');
  });

  it('lets the phone Paper tools palette move past the left source drawer handle to the edge', () => {
    vi.mocked(globalThis.localStorage.getItem).mockReturnValue(JSON.stringify({ x: 8, y: 112 }));

    act(() => {
      root.render(<PaperWorkspace />);
    });

    // The palette portals to <body> (so it stacks above the source bin), not into the workspace container.
    const palette = document.body.querySelector<HTMLElement>('[data-paper-floating-tools-palette="true"]');
    expect(palette).not.toBeNull();
    // The left source-bin handle no longer blocks the palette: it can sit at the small
    // viewport margin (8px) like the right side, instead of being pushed to a 40px gutter.
    const left = Number.parseFloat(palette?.style.left ?? '0');
    expect(left).toBeLessThan(40);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('keeps the left source drawer handle available when phone chrome is hidden', () => {
    useMobileInterfaceStore.setState({
      activeEdgeDrawer: null,
      chromeMode: 'hidden',
    });

    act(() => {
      root.render(<PaperWorkspace />);
    });

    expect(container.querySelector('[data-paper-mobile-edge-shell="true"]')).not.toBeNull();
    expect(container.querySelector('[data-paper-mobile-edge-chrome-visible="false"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Open Paper Source Library drawer"]')).not.toBeNull();

    act(() => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Paper Source Library drawer"]')?.click();
    });

    expect(useMobileInterfaceStore.getState()).toMatchObject({
      activeEdgeDrawer: 'source',
      chromeMode: 'hidden',
    });
    expect(document.body.querySelector('[data-paper-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="paper-mobile-source-bin"]')).not.toBeNull();
  });

  it('renders Paper phone edge drawer handles in a viewport overlay above the workspace layer', () => {
    act(() => {
      root.render(<PaperWorkspace />);
    });

    const overlay = document.body.querySelector('[data-paper-mobile-edge-overlay="viewport"]');
    const sourceHandle = document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Paper Source Library drawer"]');
    expect(overlay).not.toBeNull();
    expect(sourceHandle).not.toBeNull();
    expect(sourceHandle?.className).toContain('fixed');
    expect(sourceHandle?.className).toContain('z-[240]');
    expect(sourceHandle?.className).toContain('w-7');
    expect(sourceHandle?.style.left).toBe('10px');
    expect(container.querySelector('button[aria-label="Open Paper Source Library drawer"]')).toBeNull();
  });
});
