// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useMobileInterfaceStore } from '../../store/mobileInterfaceStore';
import { useTouchNavigationStore } from '../../store/touchNavigationStore';
import { ImageEditorWorkspace } from './ImageEditorWorkspace';

vi.mock('../../lib/mobilePhoneInterface', () => ({
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
vi.mock('../Layout/FlowSourceBinSidebar', () => ({
  FlowSourceBinSidebar: ({ embeddedDrawer }: { embeddedDrawer?: boolean }) => (
    <div data-embedded-drawer={embeddedDrawer ? 'true' : 'false'} data-testid="mobile-source-bin">
      Source Library
    </div>
  ),
}));
vi.mock('./ImageEditorToolbar', () => ({ ImageEditorToolbar: () => <div data-testid="mobile-tools">Tools</div> }));
vi.mock('./ImageEditorCanvas', () => ({ ImageEditorCanvas: () => <div data-testid="image-canvas">Canvas</div> }));
vi.mock('./ImageEditorTabs', () => ({ ImageEditorTabs: () => <div data-testid="image-tabs">Tabs + New</div> }));
vi.mock('./ImageEditorLayersPanel', () => ({ ImageEditorLayersPanel: () => <div>Layers panel</div> }));
vi.mock('./ImageEditorChannelsPanel', () => ({ ImageEditorChannelsPanel: () => <div>Channels panel</div> }));
vi.mock('./ImageEditorHistoryPanel', () => ({ ImageEditorHistoryPanel: () => <div>History panel</div> }));
vi.mock('./ImageEditorPathsPanel', () => ({ ImageEditorPathsPanel: () => <div>Paths panel</div> }));
vi.mock('./ImageEditorPropertiesPanel', () => ({ ImageEditorPropertiesPanel: () => <div>Properties panel</div> }));
vi.mock('./ImageEditorAssetBar', () => ({ ImageEditorAssetBar: () => <div data-testid="mobile-assets">Assets</div> }));
vi.mock('./ImageEditorHelp', () => ({ ImageEditorHelp: () => null }));
vi.mock('./GenerativeFillBar', () => ({ GenerativeFillBar: () => null }));
vi.mock('./NewDocumentModal', () => ({ NewDocumentModal: () => null }));
vi.mock('./ImageEditorContextMenu', () => ({ ImageEditorContextMenu: () => null }));
vi.mock('../DockablePanel/DockablePanelHost', () => ({
  DockablePanelHost: ({ children }: { children: ReactNode }) => <div data-testid="desktop-dock-host">{children}</div>,
}));
vi.mock('../../shared/native/useNativeMenuCommand', () => ({
  useNativeMenuCommand: () => undefined,
}));

describe('ImageEditorWorkspace mobile shell', () => {
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
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
    useMobileInterfaceStore.setState({
      activeEdgeDrawer: null,
      chromeMode: 'collapsed',
    });
    useTouchNavigationStore.setState({
      image: {
        enabled: true,
        oneFingerPan: true,
        pinchZoom: true,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses edge drawers and a floating tools palette instead of the desktop dock host on phones', () => {
    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    expect(container.querySelector('[data-image-mobile-edge-shell="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="desktop-dock-host"]')).toBeNull();
    expect(container.querySelector('[data-testid="image-tabs"]')).not.toBeNull();
    expect(container.querySelector('[data-image-workspace-document-chrome-track="true"]')?.className).toContain('min-w-max');
    expect(container.querySelector('[data-testid="mobile-tools"]')).not.toBeNull();
    expect(container.querySelector('[data-image-mobile-tools-body="true"]')?.className).toContain('overflow-x-hidden');
    expect(container.querySelector('button[aria-label="Open Source Library drawer"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Image panels drawer"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Image assets drawer"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Source Library drawer"]')?.click();
    });
    expect(container.querySelector('[data-image-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-source-bin"]')?.getAttribute('data-embedded-drawer')).toBe('true');

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Image panels drawer"]')?.click();
    });
    expect(container.querySelector('[data-image-mobile-edge-drawer="panels"]')).not.toBeNull();
    expect(container.querySelector('[data-image-mobile-edge-drawer="assets"]')).toBeNull();
    expect(container.textContent).toContain('Layers panel');
    expect(container.textContent).toContain('Properties panel');

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Image assets drawer"]')?.click();
    });
    expect(container.querySelector('[data-image-mobile-edge-drawer="panels"]')).toBeNull();
    expect(container.querySelector('[data-image-mobile-edge-drawer="assets"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-assets"]')).not.toBeNull();
  });

  it('closes an open edge drawer without hiding the mobile tools palette', () => {
    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Image panels drawer"]')?.click();
    });
    expect(container.querySelector('[data-image-mobile-edge-drawer="panels"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close Image Panels drawer"]')?.click();
    });

    expect(container.querySelector('[data-image-mobile-edge-drawer]')).toBeNull();
    expect(container.querySelector('[data-image-mobile-tools-palette="true"]')).not.toBeNull();
  });

  it('keeps the left source drawer handle available when phone chrome is hidden', () => {
    useMobileInterfaceStore.setState({
      activeEdgeDrawer: null,
      chromeMode: 'hidden',
    });

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    expect(container.querySelector('[data-image-mobile-edge-shell="true"]')).not.toBeNull();
    expect(container.querySelector('[data-image-mobile-edge-chrome-visible="false"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Source Library drawer"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Source Library drawer"]')?.click();
    });

    expect(useMobileInterfaceStore.getState()).toMatchObject({
      activeEdgeDrawer: 'source',
      chromeMode: 'hidden',
    });
    expect(container.querySelector('[data-image-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-source-bin"]')).not.toBeNull();
  });

  it('exposes Image touch navigation controls in the phone shell', () => {
    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[data-image-touch-navigation-toggle="true"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      toggle?.click();
    });

    expect(useTouchNavigationStore.getState().image.enabled).toBe(false);
  });
});
