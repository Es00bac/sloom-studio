import {
  Background,
  type Edge,
  type EdgeTypes,
  type OnConnect,
  type OnConnectEnd,
  type OnConnectStart,
  type OnEdgesChange,
  type OnNodesChange,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePinchViewport, pinchSampleFromPoints, type PinchSample } from './flowPinchZoom';
import { AlertTriangle, Braces, Bug, Loader2, Package, Sparkles, X } from 'lucide-react';
import { LibrarySearchDialog } from '../../../components/Common/LibrarySearchDialog';
import { ErrorBoundary } from '../../../components/Recovery/ErrorBoundary';
import { useI18n } from '../../../lib/useI18n';
import { useMobilePhoneInterfaceDescriptor } from '../../../lib/mobilePhoneInterface';
import type { StandardLibraryFunction } from '../../../lib/standardLibrary';
import type { FlowDiagnostic } from '../../../lib/flowSignals';
import type { AppNode } from '../../../types/flow';
import { validateFlowConnection } from '../../../lib/flowConnectionContracts';
import { TypedFlowEdge } from '../../../components/Flow/TypedFlowEdge';
import {
  FlowCardOcclusionDefs,
  FlowCardOcclusionProvider,
} from '../../../components/Flow/FlowCardOcclusionProvider';
import { createTypedConnectionLine } from '../../../components/Flow/TypedConnectionLine';

const FLOW_EDGE_TYPES: EdgeTypes = { typed: TypedFlowEdge };
export const DEFAULT_FLOW_EDGE_OPTIONS = {
  type: 'typed',
  selectable: true,
  // Wires paint above the node layer so the run into a handle is never cut off
  // by the card that owns it. Cards they are NOT attached to still cover them:
  // FlowCardOcclusionDefs clips every wire against the other card rectangles.
  zIndex: 10_000,
} as const;

export interface FlowWorkspaceShellProps {
  blockingFlowDiagnosticCount: number;
  diagnosticsOpen: boolean;
  edges: Edge[];
  flowDiagnostics: FlowDiagnostic[];
  flowOrganizeJob: { title: string; detail: string } | null;
  flowRecoveryKey: string;
  librarySearchMenu: { x: number; y: number } | null;
  nodeTypes: NodeTypes;
  nodes: AppNode[];
  /** Actionable empty-canvas surface (starter-template gallery). Rendered only while the graph has no nodes. */
  starterGallery?: ReactNode;
  /** When provided, the selection toolbar offers exporting the selection as a shareable node pack. */
  onExportSelectionNodePack?: () => void;
  onCancelFlowAutoOrganize: () => void;
  onCloseDiagnostics: () => void;
  onCloseLibrarySearch: () => void;
  onCollapseSelection: () => void;
  onConnect: OnConnect;
  onConnectEnd: OnConnectEnd;
  onConnectStart: OnConnectStart;
  onCreateGroupFromSelection: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onEdgesChange: OnEdgesChange;
  onNodeContextMenu: (event: ReactMouseEvent, node: AppNode) => void;
  onNodesChange: OnNodesChange<AppNode>;
  onPaneClick: (event: ReactMouseEvent) => void;
  onPaneContextMenu: (event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) => void;
  onSelectLibrarySearchTemplate: (template: StandardLibraryFunction) => void;
  onStartFlowAutoOrganize: () => void;
  onToggleDiagnostics: () => void;
  selectedFlowNodeCount: number;
}

export function FlowWorkspaceShell({
  blockingFlowDiagnosticCount,
  diagnosticsOpen,
  edges,
  flowDiagnostics,
  flowOrganizeJob,
  flowRecoveryKey,
  librarySearchMenu,
  nodeTypes,
  nodes,
  starterGallery,
  onExportSelectionNodePack,
  onCancelFlowAutoOrganize,
  onCloseDiagnostics,
  onCloseLibrarySearch,
  onCollapseSelection,
  onConnect,
  onConnectEnd,
  onConnectStart,
  onCreateGroupFromSelection,
  onDragOver,
  onDrop,
  onEdgesChange,
  onNodeContextMenu,
  onNodesChange,
  onPaneClick,
  onPaneContextMenu,
  onSelectLibrarySearchTemplate,
  onStartFlowAutoOrganize,
  onToggleDiagnostics,
  selectedFlowNodeCount,
}: FlowWorkspaceShellProps) {
  const { t } = useI18n();
  const mobilePhoneInterface = useMobilePhoneInterfaceDescriptor();
  const phoneFlowShell = mobilePhoneInterface.enabled;
  const reactFlow = useReactFlow();
  const store = useStoreApi();
  const pinchWrapperRef = useRef<HTMLDivElement>(null);
  const pinchSampleRef = useRef<PinchSample | null>(null);
  const [isPinching, setIsPinching] = useState(false);
  const isValidConnection = useCallback(
    (candidate: Edge | import('@xyflow/react').Connection) => validateFlowConnection(candidate, { nodes, edges }).valid,
    [edges, nodes],
  );
  const connectionLineComponent = useMemo(
    () => createTypedConnectionLine(nodes, edges),
    [edges, nodes],
  );
  const fitFlowToViewport = useCallback(() => {
    void reactFlow.fitView({
      duration: 150,
      padding: phoneFlowShell ? 0.18 : 0.12,
    });
  }, [phoneFlowShell, reactFlow]);

  // Two-finger pinch-zoom that works ANYWHERE on the canvas, including over nodes.
  // React Flow's built-in pinch is pre-empted by node dragging when a finger lands on a
  // node, so we intercept the gesture in the capture phase (before any node/pane handler
  // can claim it) and drive the viewport ourselves. Only engages with 2+ touches that
  // start inside the canvas, so single-finger pan/drag and overlay panels are untouched.
  useEffect(() => {
    const wrapper = pinchWrapperRef.current;
    if (!wrapper) return undefined;

    const sample = (touches: TouchList): PinchSample | null => {
      if (touches.length < 2) return null;
      const rect = wrapper.getBoundingClientRect();
      const a = touches[0];
      const b = touches[1];
      return pinchSampleFromPoints(
        a.clientX - rect.left,
        a.clientY - rect.top,
        b.clientX - rect.left,
        b.clientY - rect.top,
      );
    };

    const startedInsideCanvas = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.react-flow'));

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2 || !startedInsideCanvas(event.target)) return;
      pinchSampleRef.current = sample(event.touches);
      setIsPinching(true);
      // Claim the gesture before the node-drag/pane handlers downstream can.
      event.preventDefault();
      event.stopPropagation();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2 || !pinchSampleRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const next = sample(event.touches);
      if (!next) return;
      const { minZoom, maxZoom } = store.getState();
      reactFlow.setViewport(
        computePinchViewport(reactFlow.getViewport(), pinchSampleRef.current, next, { minZoom, maxZoom }),
      );
      pinchSampleRef.current = next;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        // A finger lifted but two remain — resample so the next frame doesn't jump.
        pinchSampleRef.current = sample(event.touches);
        return;
      }
      pinchSampleRef.current = null;
      setIsPinching(false);
    };

    wrapper.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    wrapper.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    wrapper.addEventListener('touchend', onTouchEnd, { capture: true });
    wrapper.addEventListener('touchcancel', onTouchEnd, { capture: true });
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart, { capture: true });
      wrapper.removeEventListener('touchmove', onTouchMove, { capture: true });
      wrapper.removeEventListener('touchend', onTouchEnd, { capture: true });
      wrapper.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [reactFlow, store]);

  useEffect(() => {
    const wrapper = pinchWrapperRef.current;
    if (!wrapper) return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement).isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      
      const isZoomIn = key === '+' || key === '=' || key === 'volumeup' || key === 'audiovolumeup';
      const isZoomOut = key === '-' || key === '_' || key === 'volumedown' || key === 'audiovolumedown';

      if (!isZoomIn && !isZoomOut) return;

      e.preventDefault();
      
      const { minZoom, maxZoom } = store.getState();
      const currentZoom = reactFlow.getZoom();
      
      // Step size matching typical browser/editor zoom steps (15%)
      const step = isZoomIn ? 1.15 : 1 / 1.15;
      const targetZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom * step));

      // Get the bounding rect to zoom towards the center of the canvas instead of the top-left origin
      const rect = wrapper.getBoundingClientRect();
      const midX = rect.width / 2;
      const midY = rect.height / 2;

      // Extract current viewport
      const current = reactFlow.getViewport();
      
      // Scale about the midpoint
      const scale = targetZoom / currentZoom;
      const x = midX - (midX - current.x) * scale;
      const y = midY - (midY - current.y) * scale;

      reactFlow.setViewport({ x, y, zoom: targetZoom });
    };

    // Use capturing phase so we intercept before nodes might swallow it (if focused)
    wrapper.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      wrapper.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [reactFlow, store]);

  return (
    <div
      className="absolute inset-0"
      data-mobile-flow-shell={phoneFlowShell ? 'true' : undefined}
      data-testid="flow-workspace-shell"
      ref={pinchWrapperRef}
    >
      <ErrorBoundary className="absolute inset-0" level="canvas" resetKeys={[flowRecoveryKey]} title="Flow Canvas">
        <FlowCardOcclusionProvider>
          <ReactFlow<AppNode, Edge>
            className="flow-wires-over-cards bg-[var(--sl-bg)]"
            connectionLineComponent={connectionLineComponent}
            defaultEdgeOptions={DEFAULT_FLOW_EDGE_OPTIONS}
            edgeTypes={FLOW_EDGE_TYPES}
            edges={edges}
            elementsSelectable={!flowOrganizeJob}
            fitView
            nodeTypes={nodeTypes}
            nodes={nodes}
            nodesConnectable={!flowOrganizeJob}
            nodesDraggable={!flowOrganizeJob && !isPinching}
            isValidConnection={isValidConnection}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onConnectStart={onConnectStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onEdgesChange={onEdgesChange}
            onNodeContextMenu={onNodeContextMenu}
            onNodesChange={onNodesChange}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            panOnDrag={!flowOrganizeJob && !isPinching}
            panOnScroll={!flowOrganizeJob}
            proOptions={{ hideAttribution: true }}
            zoomActivationKeyCode="Control"
            zoomOnPinch={!flowOrganizeJob}
            zoomOnScroll={false}
            style={phoneFlowShell ? { touchAction: 'none' } : undefined}
          >
            <Background color="#2d2d34" gap={24} size={2} />
            <FlowCardOcclusionDefs />
          </ReactFlow>
        </FlowCardOcclusionProvider>
        {phoneFlowShell ? (
          <nav
            aria-label="Flow phone actions"
            className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-[#08131b]/95 p-2 shadow-2xl backdrop-blur-md"
            data-mobile-flow-actions="true"
          >
            <button
              className="min-h-11 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-100/70 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
              data-mobile-flow-fit="true"
              onClick={fitFlowToViewport}
              type="button"
            >
              Fit canvas
            </button>
            <button
              className="min-h-11 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-100/70 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
              disabled={Boolean(flowOrganizeJob) || nodes.length === 0}
              onClick={onStartFlowAutoOrganize}
              type="button"
            >
              <Sparkles aria-hidden="true" className="mr-1 inline align-[-2px]" size={14} />
              Clean
            </button>
            <button
              aria-controls="flow-diagnostics"
              aria-expanded={diagnosticsOpen}
              className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                blockingFlowDiagnosticCount > 0
                  ? 'border-rose-300/45 bg-rose-500/15 text-rose-50 hover:border-rose-100/80'
                  : flowDiagnostics.length > 0
                    ? 'border-amber-300/35 bg-amber-400/10 text-amber-50 hover:border-amber-100/70'
                    : 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50 hover:border-emerald-100/70'
              }`}
              onClick={onToggleDiagnostics}
              title="Open Flow diagnostics and debug log"
              type="button"
            >
              {blockingFlowDiagnosticCount > 0 ? <AlertTriangle aria-hidden="true" className="mr-1 inline align-[-2px]" size={14} /> : <Bug aria-hidden="true" className="mr-1 inline align-[-2px]" size={14} />}
              Checks {flowDiagnostics.length}
            </button>
          </nav>
        ) : (
          <>
            <button
              className="absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-[#0d141f]/90 px-3 py-2 text-xs font-semibold text-cyan-50 shadow-xl transition-colors hover:border-cyan-200/70 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
              disabled={Boolean(flowOrganizeJob) || nodes.length === 0}
              onClick={onStartFlowAutoOrganize}
              type="button"
            >
              <Sparkles size={14} />
              Clean Flow
            </button>
            <button
              className={`absolute right-4 top-16 z-20 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold shadow-xl transition-colors ${
                blockingFlowDiagnosticCount > 0
                  ? 'border-rose-300/45 bg-rose-500/15 text-rose-50 hover:border-rose-100/80'
                  : flowDiagnostics.length > 0
                    ? 'border-amber-300/35 bg-amber-400/10 text-amber-50 hover:border-amber-100/70'
                    : 'border-emerald-300/30 bg-[#0d141f]/90 text-emerald-50 hover:border-emerald-100/70'
              }`}
              onClick={onToggleDiagnostics}
              title="Open Flow diagnostics and debug log"
              type="button"
            >
              {blockingFlowDiagnosticCount > 0 ? <AlertTriangle size={14} /> : <Bug size={14} />}
              Diagnostics {flowDiagnostics.length}
            </button>
          </>
        )}
        {diagnosticsOpen ? (
          <FlowDiagnosticsPanel
            diagnostics={flowDiagnostics}
            nodes={nodes}
            onClose={onCloseDiagnostics}
            phoneFlowShell={phoneFlowShell}
          />
        ) : null}
        {selectedFlowNodeCount > 0 && !flowOrganizeJob ? (
          <div className={`${phoneFlowShell ? 'absolute inset-x-2 bottom-16 z-20 flex max-h-24 items-center gap-2 overflow-x-auto rounded-xl border border-emerald-300/25 bg-[#08131b]/95 px-3 py-2 text-xs text-emerald-50 shadow-2xl backdrop-blur-md' : 'absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-300/25 bg-[#08131b]/95 px-3 py-2 text-xs text-emerald-50 shadow-2xl backdrop-blur-md'}`}>
            <span className="font-semibold text-emerald-100">{selectedFlowNodeCount} selected</span>
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 font-semibold transition-colors hover:border-emerald-100/70 hover:bg-emerald-300/20"
              onClick={onCollapseSelection}
              title="Replace the selected logic with one reusable function node. External wires become function inputs and outputs."
              type="button"
            >
              <Braces size={14} />
              Collapse into reusable function
            </button>
            <button
              className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 font-semibold text-cyan-50 transition-colors hover:border-cyan-100/70 hover:bg-cyan-300/20"
              onClick={onCreateGroupFromSelection}
              title="Draw a workspace group around the selected nodes without hiding them."
              type="button"
            >
              Group only
            </button>
            {onExportSelectionNodePack ? (
              <button
                className="rounded-lg border border-fuchsia-300/25 bg-fuchsia-500/10 px-3 py-1.5 font-semibold text-fuchsia-50 transition-colors hover:border-fuchsia-100/70 hover:bg-fuchsia-500/20"
                data-export-node-pack="true"
                onClick={onExportSelectionNodePack}
                title={t('flow.nodePack.exportHint')}
                type="button"
              >
                <Package aria-hidden="true" className="mr-1 inline align-[-2px]" size={13} />
                {t('flow.nodePack.exportAction')}
              </button>
            ) : null}
          </div>
        ) : null}
        {flowOrganizeJob ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-sm rounded-md border border-cyan-300/25 bg-[#0d141f] p-4 text-cyan-50 shadow-2xl">
              <div className="flex items-start gap-3">
                <Loader2 className="mt-0.5 animate-spin text-cyan-200" size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{flowOrganizeJob.title}</div>
                  <div className="mt-1 text-xs leading-5 text-cyan-100/75">{flowOrganizeJob.detail}</div>
                </div>
                <button
                  aria-label="Cancel Flow cleanup"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-cyan-300/25 text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white"
                  onClick={onCancelFlowAutoOrganize}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              <button
                className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-200/70"
                onClick={onCancelFlowAutoOrganize}
                type="button"
              >
                Cancel and Revert
              </button>
            </div>
          </div>
        ) : null}
        {nodes.length === 0 && !flowOrganizeJob && starterGallery ? starterGallery : null}
        {librarySearchMenu ? (
          <LibrarySearchDialog
            onClose={onCloseLibrarySearch}
            onSelect={onSelectLibrarySearchTemplate}
            x={librarySearchMenu.x}
            y={librarySearchMenu.y}
          />
        ) : null}
      </ErrorBoundary>
    </div>
  );
}

function FlowDiagnosticsPanel({
  diagnostics,
  nodes,
  onClose,
  phoneFlowShell,
}: {
  diagnostics: FlowDiagnostic[];
  nodes: AppNode[];
  onClose: () => void;
  phoneFlowShell: boolean;
}) {
  const activeRuns = nodes.filter((node) => node.data.isRunning || node.data.statusMessage || node.data.error);
  return (
    <aside
      className={phoneFlowShell
        ? 'absolute inset-x-2 bottom-16 z-30 flex max-h-[min(50vh,420px)] flex-col overflow-hidden rounded-xl border border-cyan-300/20 bg-[#08111c]/95 text-cyan-50 shadow-2xl backdrop-blur-xl'
        : 'absolute right-4 top-28 z-30 flex max-h-[min(620px,calc(100vh-160px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-cyan-300/20 bg-[#08111c]/95 text-cyan-50 shadow-2xl backdrop-blur-xl'}
      id="flow-diagnostics"
    >
      <header className="flex items-start justify-between gap-3 border-b border-cyan-300/15 p-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100">
            <Bug size={14} />
            Flow diagnostics
          </div>
          <p className="mt-1 text-[11px] leading-5 text-cyan-100/55">
            Critical issues block runs. Warnings explain risky but runnable graph logic.
          </p>
        </div>
        <button
          className="rounded-md border border-cyan-300/20 p-1.5 text-cyan-100/70 transition-colors hover:border-cyan-100/70 hover:text-white"
          onClick={onClose}
          type="button"
        >
          <X size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold">
          <div className="rounded-lg border border-rose-300/20 bg-rose-400/10 p-2 text-rose-100">
            {diagnostics.filter((diagnostic) => diagnostic.severity === 'critical').length} critical
          </div>
          <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-amber-100">
            {diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length} warnings
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-2 text-cyan-100">
            {activeRuns.length} log
          </div>
        </div>
        <div className="space-y-2">
          {diagnostics.length === 0 ? (
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
              No broken Flow logic detected.
            </div>
          ) : diagnostics.map((diagnostic) => (
            <div
              className={`rounded-lg border p-3 text-xs leading-5 ${
                diagnostic.severity === 'critical'
                  ? 'border-rose-300/25 bg-rose-500/10 text-rose-50'
                  : diagnostic.severity === 'warning'
                    ? 'border-amber-300/25 bg-amber-400/10 text-amber-50'
                    : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-50'
              }`}
              key={`${diagnostic.id}-${diagnostic.nodeId ?? ''}-${diagnostic.edgeId ?? ''}`}
            >
              <div className="font-semibold uppercase tracking-wide">
                {diagnostic.severity}{diagnostic.blocksRun ? ' · blocks run' : ''}
              </div>
              <div className="mt-1">{diagnostic.message}</div>
              {diagnostic.nodeId || diagnostic.edgeId ? (
                <div className="mt-1 text-[11px] opacity-70">
                  {diagnostic.nodeId ? `Node: ${diagnostic.nodeId}` : null}
                  {diagnostic.nodeId && diagnostic.edgeId ? ' · ' : null}
                  {diagnostic.edgeId ? `Edge: ${diagnostic.edgeId}` : null}
                </div>
              ) : null}
              {diagnostic.suggestedFix ? (
                <div className="mt-2 rounded bg-black/20 px-2 py-1 text-[11px] opacity-85">
                  Fix: {diagnostic.suggestedFix}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {activeRuns.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/55">Run log</div>
            <div className="space-y-2">
              {activeRuns.map((node) => (
                <div className="rounded-lg border border-cyan-300/15 bg-black/20 p-2 text-xs leading-5" key={node.id}>
                  <div className="font-semibold text-cyan-100">{node.data.customTitle ?? node.id}</div>
                  <div className={node.data.error ? 'text-rose-100' : 'text-cyan-100/65'}>
                    {node.data.error ?? node.data.statusMessage ?? (node.data.isRunning ? 'Running...' : 'Idle')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
