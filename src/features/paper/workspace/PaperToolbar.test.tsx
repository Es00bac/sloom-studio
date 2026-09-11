// @vitest-environment jsdom
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaperMobileEdgeShell, PaperToolbar, PaperTopStrip } from './PaperWorkspace';
import { PAPER_TOOL_DEFINITIONS } from './paperToolRegistry';
import type { PaperTool } from '../../../types/paper';

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

function dispatchPointerUp(element: Element, pointerType: string) {
  const event = new Event('pointerup', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: 0 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  element.dispatchEvent(event);
}

function dispatchPointerDown(element: Element, pointerType: string) {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: 0 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'isPrimary', { value: true });
  element.dispatchEvent(event);
}

function dispatchTouchStart(element: Element) {
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
}

function dispatchMouseDown(element: Element) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
  }
  mountedContainer?.remove();
  mountedRoot = null;
  mountedContainer = null;
  vi.unstubAllGlobals();
});

describe('PaperToolbar', () => {
  // Asserts the SHIPPED three-column palette. (An earlier WIP draft of this test expected a
  // two-column layout that was never built — if the palette moves to 2 columns, flip the
  // grid-cols assertion below with it.)
  it('renders as a compact three-column tools palette with no icon gaps', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PaperToolbar
        activeTool="select"
        canPasteStyle={false}
        onAddComicSfx={noop}
        onAddFrame={noop}
        onCopy={noop}
        onCopyStyle={noop}
        onCut={noop}
        onPaste={noop}
        onPasteStyle={noop}
        onRedo={noop}
        onSetTool={noop}
        onUndo={noop}
      />,
    );

    expect(html).toContain('data-paper-tools-panel="true"');
    expect(html).toContain('data-paper-tools-grid="true"');
    expect(html).toContain('data-paper-color-well="true"');
    expect(html).toContain('grid-cols-3');
    expect(html).toContain('gap-0');
    expect(html).toContain('aria-label="Select"');
    expect(html).toContain('aria-label="Gutter knife"');
    expect(html).toContain('aria-label="Frame fill color"');
    expect(html).toContain('aria-label="Frame stroke color"');
    expect(html).not.toContain('gap-2');
    expect(html).not.toContain('rounded-lg');
  });

  it('gives every tool a visually distinct icon (no two tools share a glyph)', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PaperToolbar
        activeTool="select"
        canPasteStyle={false}
        onAddComicSfx={noop}
        onAddFrame={noop}
        onCopy={noop}
        onCopyStyle={noop}
        onCut={noop}
        onPaste={noop}
        onPasteStyle={noop}
        onRedo={noop}
        onSetTool={noop}
        onUndo={noop}
      />,
    );
    const doc = document.createElement('div');
    doc.innerHTML = html;

    const iconByTool = new Map<string, string>();
    for (const definition of PAPER_TOOL_DEFINITIONS) {
      const button = doc.querySelector(`button[aria-label="${definition.label}"]`);
      expect(button, `no toolbar button for ${definition.tool}`).not.toBeNull();
      const svg = button!.querySelector('svg');
      expect(svg, `no icon svg for ${definition.tool}`).not.toBeNull();
      const signature = Array.from(svg!.classList)
        .filter((cls) => cls.startsWith('lucide-'))
        .sort()
        .join(' ');
      expect(signature, `no lucide icon class for ${definition.tool}`).toBeTruthy();
      iconByTool.set(definition.tool, signature);
    }

    const distinct = new Set(iconByTool.values());
    expect(distinct.size, `shared icons across tools: ${JSON.stringify([...iconByTool])}`)
      .toBe(iconByTool.size);
  });

  it('activates Paper tools from primary pointer release without relying on synthesized click', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const textFrameButton = mountedContainer.querySelector('button[aria-label="Text frame"]');
    expect(textFrameButton).not.toBeNull();

    act(() => {
      dispatchPointerUp(textFrameButton!, 'pen');
    });

    expect(selectedTools).toEqual(['text']);
  });

  it('activates Paper tools from primary pointer contact when Android does not synthesize a click', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const imageFrameButton = mountedContainer.querySelector('button[aria-label="Image frame"]');
    expect(imageFrameButton).not.toBeNull();

    act(() => {
      dispatchPointerDown(imageFrameButton!, 'touch');
    });

    expect(selectedTools).toEqual(['image']);
  });

  it('does not execute a Paper toolbar action twice when pointer release is followed by a click', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const eyedropperButton = mountedContainer.querySelector('button[aria-label="Eyedropper"]');
    expect(eyedropperButton).not.toBeNull();

    act(() => {
      dispatchPointerUp(eyedropperButton!, 'touch');
      eyedropperButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(selectedTools).toEqual(['eyedropper']);
  });

  it('does not execute a Paper toolbar action twice when pointer contact is followed by pointer release and click', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const selectButton = mountedContainer.querySelector('button[aria-label="Select"]');
    expect(selectButton).not.toBeNull();

    act(() => {
      dispatchPointerDown(selectButton!, 'pen');
      dispatchPointerUp(selectButton!, 'pen');
      selectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(selectedTools).toEqual(['select']);
  });

  it('activates Paper tools from touchstart when Android WebView does not deliver pointer events', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const captionButton = mountedContainer.querySelector('button[aria-label="Caption"]');
    expect(captionButton).not.toBeNull();

    act(() => {
      dispatchTouchStart(captionButton!);
    });

    expect(selectedTools).toEqual(['caption']);
  });

  it('activates Paper tools from mousedown when a stylus is exposed as mouse input', () => {
    const selectedTools: PaperTool[] = [];
    const noop = () => {};
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperToolbar
          activeTool="select"
          canPasteStyle={false}
          onAddComicSfx={noop}
          onAddFrame={(tool) => selectedTools.push(tool)}
          onCopy={noop}
          onCopyStyle={noop}
          onCut={noop}
          onPaste={noop}
          onPasteStyle={noop}
          onRedo={noop}
          onSetTool={(tool) => selectedTools.push(tool)}
          onUndo={noop}
        />,
      );
    });

    const handButton = mountedContainer.querySelector('button[aria-label="Hand"]');
    expect(handButton).not.toBeNull();

    act(() => {
      dispatchMouseDown(handButton!);
    });

    expect(selectedTools).toEqual(['hand']);
  });
});

describe('PaperTopStrip touch navigation', () => {
  it('does not duplicate the dedicated floating touch navigation control', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PaperTopStrip
        docTitle="Touch Layout"
        onAddPage={noop}
        onDuplicatePage={noop}
        onExportCbz={noop}
        onExportIdml={noop}
        onExportJson={noop}
        onExportKdpAssets={noop}
        onExportPdf={noop}
        onExportAccessiblePdf={noop}
        onExportEpub={noop}
        onExportPageToImage={noop}
        onExportPageToSource={noop}
        onExportPagesToEnvelope={noop}
        onExportReaderSpreadsPdf={noop}
        onExportBookletProofPdf={noop}
        onExportStoriesDocx={noop}
        onExportStoriesHtml={noop}
        onExportStoriesRtf={noop}
        onExportStoriesTxt={noop}
        onExportWebcomicImages={noop}
        onFinalizePrintUpscale={noop}
        onImportJson={noop}
        onNew={noop}
        onPackagePrint={noop}
        onShowPreflight={noop}
        onShowFindChange={noop}
        onToggleGrid={noop}
        onToggleGuides={noop}
        onToggleTextBaselines={noop}
        onToggleFrameEdges={noop}
        onToggleInspector={noop}
        onToggleRulers={noop}
        onToggleSnapToGrid={noop}
        onToggleSnapToGuides={noop}
        onToggleSpreads={noop}
        onToggleStartOnRight={noop}
        onToggleRtlBinding={noop}
        onToggleToolbar={noop}
        onZoomIn={noop}
        onZoomOut={noop}
        placement="titlebar"
        preflightStatus={{ tone: 'ready', label: 'Ready', countsLabel: '0 issues', detail: 'No issues' }}
        showGrid={false}
        showFrameEdges={false}
        showGuides={false}
        showTextBaselines={false}
        showInspector={false}
        showPreflight={false}
        showFindChange={false}
        showRulers={false}
        showSpreads={false}
        showToolbar={true}
        snapToGrid={false}
        snapToGuides={false}
        startOnRight={false}
        rtlBinding={false}
        zoom={1}
      />,
    );

    expect(html).not.toContain('data-paper-touch-navigation-topstrip="true"');
  });
});

describe('PaperMobileEdgeShell', () => {
  it('renders Paper phone source, panel, and asset drawers with one drawer open at a time', () => {
    let activeDrawer: 'source' | 'panels' | 'assets' | null = null;
    const renderShell = () => {
      mountedRoot?.render(
        <PaperMobileEdgeShell
          activeEdgeDrawer={activeDrawer}
          assetsDrawer={<div data-testid="paper-mobile-assets">Linked assets</div>}
          onCloseEdgeDrawer={() => {
            activeDrawer = null;
            renderShell();
          }}
          onToggleEdgeDrawer={(drawerId) => {
            activeDrawer = activeDrawer === drawerId ? null : drawerId;
            renderShell();
          }}
          rightPanels={[
            { id: 'inspector', title: 'Inspector', content: <div>Inspector panel</div>, defaultOpen: true },
            { id: 'preflight', title: 'Preflight', content: <div>Preflight panel</div> },
          ]}
          sourceDrawer={<div data-testid="paper-mobile-source">Source Library</div>}
          visible
        >
          <div data-testid="paper-canvas">Paper Canvas</div>
          <div data-testid="paper-tools">Tools</div>
        </PaperMobileEdgeShell>,
      );
    };
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      renderShell();
    });

    const container = mountedContainer;
    expect(container).not.toBeNull();
    if (!container) throw new Error('Paper mobile edge shell test container was not mounted.');

    expect(container.querySelector('[data-paper-mobile-edge-shell="true"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Paper Source Library drawer"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Paper panels drawer"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Paper assets drawer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="paper-tools"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Paper panels drawer"]')?.click();
    });
    expect(container.querySelector('[data-paper-mobile-edge-drawer="panels"]')).not.toBeNull();
    expect(container.querySelector('[data-paper-mobile-edge-drawer="source"]')).toBeNull();
    expect(container.textContent).toContain('Inspector panel');
    expect(container.textContent).toContain('Preflight panel');

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Paper Source Library drawer"]')?.click();
    });
    expect(container.querySelector('[data-paper-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(container.querySelector('[data-paper-mobile-edge-drawer="panels"]')).toBeNull();
    expect(container.querySelector('[data-testid="paper-mobile-source"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Paper assets drawer"]')?.click();
    });
    expect(container.querySelector('[data-paper-mobile-edge-drawer="assets"]')).not.toBeNull();
    expect(container.querySelector('[data-paper-mobile-edge-drawer="source"]')).toBeNull();
    expect(container.querySelector('[data-testid="paper-mobile-assets"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close Paper Assets drawer"]')?.click();
    });
    expect(container.querySelector('[data-paper-mobile-edge-drawer]')).toBeNull();
    expect(container.querySelector('[data-testid="paper-tools"]')).not.toBeNull();
  });

  it('keeps compact Paper phone drawer handles when top chrome is hidden', () => {
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperMobileEdgeShell
          activeEdgeDrawer={null}
          assetsDrawer={<div>Linked assets</div>}
          onCloseEdgeDrawer={() => undefined}
          onToggleEdgeDrawer={() => undefined}
          rightPanels={[{ id: 'inspector', title: 'Inspector', content: <div>Inspector panel</div> }]}
          sourceDrawer={<div>Source Library</div>}
          visible={false}
        >
          <div data-testid="paper-canvas">Paper Canvas</div>
          <div data-testid="paper-tools">Tools</div>
        </PaperMobileEdgeShell>,
      );
    });

    expect(mountedContainer.querySelector('[data-paper-mobile-edge-shell="true"]')).not.toBeNull();
    expect(mountedContainer.querySelector('[data-paper-mobile-edge-chrome-visible="false"]')).not.toBeNull();
    expect(mountedContainer.querySelectorAll('[data-mobile-edge-handle="paper"]')).toHaveLength(3);
    const sourceHandle = mountedContainer.querySelector('button[aria-label="Open Paper Source Library drawer"]');
    expect(sourceHandle?.getAttribute('data-mobile-edge-handle-compact')).toBe('true');
    expect(sourceHandle?.getAttribute('data-mobile-edge-handle-edge')).toBe('source');
    expect(sourceHandle?.getAttribute('data-mobile-edge-handle-visible')).toBe('true');
    expect(sourceHandle?.getAttribute('data-mobile-edge-source-visible-strip')).toBe('true');
    expect(sourceHandle?.className).toContain('left-2');
    expect(sourceHandle?.className).toContain('w-7');
    expect(sourceHandle?.className).toContain('rounded-r-md');
    expect(sourceHandle?.className).toContain('z-[110]');
    expect(mountedContainer.querySelector('[data-paper-mobile-edge-drawer]')).toBeNull();
    expect(mountedContainer.querySelector('[data-testid="paper-canvas"]')).not.toBeNull();
    expect(mountedContainer.querySelector('[data-testid="paper-tools"]')).not.toBeNull();
  });

  it('keeps the compact Paper source drawer handle inset inside the Android safe edge', () => {
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperMobileEdgeShell
          activeEdgeDrawer={null}
          assetsDrawer={<div>Linked assets</div>}
          onCloseEdgeDrawer={() => undefined}
          onToggleEdgeDrawer={() => undefined}
          rightPanels={[{ id: 'inspector', title: 'Inspector', content: <div>Inspector panel</div> }]}
          sourceDrawer={<div>Source Library</div>}
          visible={false}
        >
          <div data-testid="paper-canvas">Paper Canvas</div>
        </PaperMobileEdgeShell>,
      );
    });

    const sourceHandle = mountedContainer.querySelector('button[aria-label="Open Paper Source Library drawer"]');
    expect(sourceHandle).not.toBeNull();
    expect(sourceHandle?.getAttribute('data-mobile-edge-source-visible-strip')).toBe('true');
    expect(sourceHandle?.className).toContain('left-2');
    expect(sourceHandle?.className).toContain('w-7');
    expect(sourceHandle?.className).not.toContain('left-0');
    expect(sourceHandle?.className).not.toContain('w-6');
  });

  it('opens the Paper source drawer from pen pointer release without a synthesized click', () => {
    let activeDrawer: 'source' | 'panels' | 'assets' | null = null;
    const renderShell = () => {
      mountedRoot?.render(
        <PaperMobileEdgeShell
          activeEdgeDrawer={activeDrawer}
          assetsDrawer={<div>Linked assets</div>}
          onCloseEdgeDrawer={() => {
            activeDrawer = null;
            renderShell();
          }}
          onToggleEdgeDrawer={(drawerId) => {
            activeDrawer = activeDrawer === drawerId ? null : drawerId;
            renderShell();
          }}
          rightPanels={[{ id: 'inspector', title: 'Inspector', content: <div>Inspector panel</div> }]}
          sourceDrawer={<div data-testid="paper-mobile-source">Source Library</div>}
          visible={false}
        >
          <div data-testid="paper-canvas">Paper Canvas</div>
        </PaperMobileEdgeShell>,
      );
    };
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      renderShell();
    });

    const sourceHandle = mountedContainer.querySelector('button[aria-label="Open Paper Source Library drawer"]');
    expect(sourceHandle).not.toBeNull();

    act(() => {
      dispatchPointerUp(sourceHandle!, 'pen');
    });

    expect(mountedContainer.querySelector('[data-paper-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(mountedContainer.querySelector('[data-testid="paper-mobile-source"]')).not.toBeNull();
  });

  it('can show the Paper source drawer while top chrome remains hidden', () => {
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    act(() => {
      mountedRoot?.render(
        <PaperMobileEdgeShell
          activeEdgeDrawer="source"
          assetsDrawer={<div>Linked assets</div>}
          onCloseEdgeDrawer={() => undefined}
          onToggleEdgeDrawer={() => undefined}
          rightPanels={[{ id: 'inspector', title: 'Inspector', content: <div>Inspector panel</div> }]}
          sourceDrawer={<div data-testid="paper-mobile-source">Source Library</div>}
          visible={false}
        >
          <div data-testid="paper-canvas">Paper Canvas</div>
        </PaperMobileEdgeShell>,
      );
    });

    expect(mountedContainer.querySelector('[data-paper-mobile-edge-chrome-visible="false"]')).not.toBeNull();
    expect(mountedContainer.querySelector('[data-paper-mobile-edge-drawer="source"]')).not.toBeNull();
    expect(mountedContainer.querySelector('[data-testid="paper-mobile-source"]')).not.toBeNull();
  });
});
