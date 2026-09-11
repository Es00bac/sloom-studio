import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { FlowWorkspaceShell, type FlowWorkspaceShellProps } from './FlowWorkspaceShell';
import type { AppNode } from '../../../types/flow';
import { useSettingsStore } from '../../../store/settingsStore';

vi.mock('@xyflow/react', async () => {
  return {
    Background: () => <div data-testid="flow-background" />,
    BaseEdge: () => <path />,
    Controls: () => <div data-testid="flow-controls" />,
    ReactFlow: (props: { children?: ReactNode } & Record<string, unknown>) => (
      <div data-testid="react-flow-shell">{props.children}</div>
    ),
    getBezierPath: () => ['M 0 0 L 1 1', 0.5, 0.5],
    useReactFlow: () => ({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: () => {},
    }),
    useStoreApi: () => ({
      getState: () => ({ minZoom: 0.5, maxZoom: 2 }),
    }),
    useStore: (selector: (state: unknown) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

function makeNode(id: string): AppNode {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data: {} };
}

function shellProps(overrides: Partial<FlowWorkspaceShellProps> = {}): FlowWorkspaceShellProps {
  return {
    blockingFlowDiagnosticCount: 0,
    diagnosticsOpen: false,
    flowDiagnostics: [],
    flowOrganizeJob: null,
    flowRecoveryKey: 'flow::starter-gallery',
    librarySearchMenu: null,
    nodeTypes: {} as Record<string, ComponentType<any>>,
    nodes: [] as AppNode[],
    edges: [] as Edge[],
    onCloseDiagnostics: () => {},
    onCloseLibrarySearch: () => {},
    onCollapseSelection: () => {},
    onConnect: () => {},
    onConnectEnd: () => {},
    onConnectStart: () => {},
    onCreateGroupFromSelection: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    onEdgesChange: () => {},
    onNodeContextMenu: () => {},
    onNodesChange: () => {},
    onPaneClick: () => {},
    onPaneContextMenu: () => {},
    onSelectLibrarySearchTemplate: () => {},
    onStartFlowAutoOrganize: () => {},
    onToggleDiagnostics: () => {},
    onCancelFlowAutoOrganize: () => {},
    selectedFlowNodeCount: 0,
    ...overrides,
  };
}

describe('FlowWorkspaceShell starter-gallery empty state (MH-094)', () => {
  const starterGallery = (
    <div data-testid="starter-gallery-surface">
      <button onClick={() => undefined} type="button">Add Text to image template</button>
    </div>
  );

  it('renders the actionable starter-gallery surface while the canvas has no nodes', () => {
    const html = renderToStaticMarkup(
      <FlowWorkspaceShell {...shellProps({ starterGallery })} />,
    );
    expect(html).toContain('data-testid="starter-gallery-surface"');
    expect(html).toContain('Add Text to image template');
  });

  it('hides the starter-gallery surface as soon as the graph has nodes', () => {
    const html = renderToStaticMarkup(
      <FlowWorkspaceShell {...shellProps({ nodes: [makeNode('node-1')], starterGallery })} />,
    );
    expect(html).not.toContain('data-testid="starter-gallery-surface"');
  });

  it('omits the empty state entirely when no gallery is provided', () => {
    const html = renderToStaticMarkup(<FlowWorkspaceShell {...shellProps()} />);
    expect(html).not.toContain('data-starter-template-panel');
  });

  it('offers node-pack export in the selection toolbar only while nodes are selected', () => {
    const selected = [{ ...makeNode('node-1'), selected: true }] as AppNode[];
    const withExport = renderToStaticMarkup(
      <FlowWorkspaceShell {...shellProps({ nodes: selected, selectedFlowNodeCount: 1, onExportSelectionNodePack: () => undefined })} />,
    );
    expect(withExport).toContain('data-export-node-pack="true"');
    expect(withExport).toContain('Export node pack');
    expect(withExport).toContain('1 selected');

    // Unselected nodes: no selection toolbar at all.
    const unselected = renderToStaticMarkup(
      <FlowWorkspaceShell {...shellProps({ nodes: [makeNode('node-1')], onExportSelectionNodePack: () => undefined })} />,
    );
    expect(unselected).not.toContain('data-export-node-pack');

    // Selected nodes but no handler wired: the action stays hidden.
    const withoutHandler = renderToStaticMarkup(
      <FlowWorkspaceShell {...shellProps({ nodes: selected, selectedFlowNodeCount: 1 })} />,
    );
    expect(withoutHandler).not.toContain('data-export-node-pack');
  });

  describe('node-pack export button localization (Faye Rowan P2: English-only export button)', () => {
    const originalLocale = useSettingsStore.getState().locale;

    afterEach(() => {
      useSettingsStore.getState().setLocale(originalLocale);
    });

    it('keeps the English export button text by default', () => {
      useSettingsStore.getState().setLocale('en');
      const selected = [{ ...makeNode('node-1'), selected: true }] as AppNode[];
      const html = renderToStaticMarkup(
        <FlowWorkspaceShell {...shellProps({ nodes: selected, selectedFlowNodeCount: 1, onExportSelectionNodePack: () => undefined })} />,
      );
      expect(html).toContain('Export node pack');
    });

    // `renderToStaticMarkup` reads zustand's default (initial) snapshot rather than a
    // post-mutation `getState()` value, so a locale switch right before an SSR render — as
    // opposed to a real client mount — doesn't reliably reach the rendered output here. The
    // *wiring* (component calls `t(...)`, not a hardcoded string; the catalog carries both
    // languages) is what a regression could actually break, so that's what's checked
    // directly instead of relying on this render path for the Japanese string itself.
    it('renders through the i18n catalog instead of a hardcoded English string', () => {
      const source = readFileSync(new URL('./FlowWorkspaceShell.tsx', import.meta.url), 'utf8');
      expect(source).toContain("t('flow.nodePack.exportAction')");
      expect(source).toContain("t('flow.nodePack.exportHint')");
      expect(source).not.toContain('>Export node pack<');
      expect(source).not.toContain('title="Save the selected nodes and their internal connections as a shareable .sloompack file."');
    });

    it('provides both English and Japanese for the export button label and tooltip, matching the already-bilingual import entry', () => {
      const catalog = readFileSync(new URL('../../../lib/i18n.ts', import.meta.url), 'utf8');
      expect(catalog).toContain("'flow.nodePack.exportAction': { en: 'Export node pack', ja: 'ノードパックを書き出す' }");
      expect(catalog).toContain('共有可能な .sloompack ファイルとして保存します');
    });
  });
});
