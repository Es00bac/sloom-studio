import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { Bookmark, Check, Clock, Maximize2, Minimize2, MoreHorizontal, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { OutputPortMenu } from './OutputPortMenu';
import { TypedHandle as Handle } from './TypedHandle';
import { FlowNodeHandleContext } from './flowNodeHandleContext';
import { dispatchNodeContextMenu, getNodeContextMenuAnchor, useCoarsePointer } from './nodeContextMenuTrigger';
import { SharedContextMenu } from '../Common/SharedContextMenu';
import type { NodeActionTemplate } from '../../lib/nodeActionMenu';
import { getNodeTheme } from '../../lib/nodeTheme';
import { resolveNodeDisplayTitle } from '../../lib/nodeBookmarks';
import {
  shouldOpenNodeTitleContextMenu,
  withFlowNodeInteractionClasses,
} from '../../lib/flowNodeInteraction';
import {
  buildRoutedLoopInputs,
  collectListLoopInputs,
  normalizeListLoopMode,
  resolveLoopRunCount,
} from '../../lib/listExecution';
import { collectPromptSignalForNode, getSignalIterationCount } from '../../lib/flowSignals';
import { LOOP_BREAK_TARGET_HANDLE } from '../../lib/flowControlHandles';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeType, ListLoopMode } from '../../types/flow';
import type { SharedContextMenuItem } from '../../lib/sharedContextMenu';

interface BaseNodeProps {
  nodeId?: string;
  nodeType?: FlowNodeType;
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  hasInput?: boolean;
  hasOutput?: boolean;
  customHandles?: React.ReactNode;
  onRun?: () => void;
  runDisabledReason?: string;
  isRunning?: boolean;
  retryState?: { attempt: number; max: number; nextAttemptAt: number };
  error?: string;
  statusMessage?: string;
  footerActions?: React.ReactNode;
  outputActions?: NodeActionTemplate[];
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  collapsedContent?: React.ReactNode;
  showLoopBreak?: boolean;
}

export const BaseNode: React.FC<BaseNodeProps> = ({
  nodeId,
  nodeType,
  icon: Icon,
  title,
  children,
  hasInput = true,
  hasOutput = true,
  customHandles,
  onRun,
  runDisabledReason,
  isRunning = false,
  retryState,
  error,
  statusMessage,
  footerActions,
  outputActions = [],
  containerClassName,
  containerStyle,
  isCollapsed = false,
  onToggleCollapsed,
  collapsedContent,
  showLoopBreak = true,
}) => {
  const hasFooter = Boolean(onRun) || Boolean(footerActions);
  const visibleContent = isCollapsed && collapsedContent ? collapsedContent : children;
  const nodeData = useFlowStore(
    (state) => nodeId ? state.nodes.find((node) => node.id === nodeId)?.data : undefined,
  );
  const theme = getNodeTheme(nodeType, nodeData);
  const customTitle = useFlowStore(
    (state) => nodeId ? state.nodes.find((node) => node.id === nodeId)?.data.customTitle : undefined,
  );
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const renameNodeBookmark = useFlowStore((state) => state.renameNodeBookmark);
  const clearNodeBookmark = useFlowStore((state) => state.clearNodeBookmark);
  const cancelNodeRun = useFlowStore((state) => state.cancelNodeRun);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const currentNodeSelected = Boolean(nodeId && nodes.find((node) => node.id === nodeId)?.selected);
  const displayTitle = resolveNodeDisplayTitle(title, customTitle);
  const currentBookmarkTitle = typeof customTitle === 'string' ? customTitle.trim() : '';
  const currentListLoopMode = normalizeListLoopMode(
    nodeId ? nodes.find((node) => node.id === nodeId)?.data.listLoopMode : undefined,
  );
  const listLoopSummary = useMemo(() => {
    if (!nodeId || !onRun) {
      return undefined;
    }

    const inputs = collectListLoopInputs(nodeId, nodes, edges);
    const promptSignal = collectPromptSignalForNode(nodeId, nodes, edges);
    const promptSignalIterationCount = getSignalIterationCount(promptSignal);
    const routedInputs = buildRoutedLoopInputs(inputs, promptSignal);
    const promptAxisCount = promptSignalIterationCount > 1 ? 1 : 0;
    const axisCount = routedInputs.length + promptAxisCount;

    if (axisCount < 2) {
      return undefined;
    }

    const getRunCount = (mode: ListLoopMode) => {
      try {
        return resolveLoopRunCount(routedInputs, mode, promptSignal);
      } catch {
        return undefined;
      }
    };

    return {
      inputCount: axisCount,
      pairedCount: getRunCount('paired'),
      allCombinationsCount: getRunCount('allCombinations'),
    };
  }, [edges, nodeId, nodes, onRun]);
  const activeLoopRunCount = listLoopSummary
    ? currentListLoopMode === 'allCombinations'
      ? listLoopSummary.allCombinationsCount
      : listLoopSummary.pairedCount
    : undefined;
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: SharedContextMenuItem[];
  } | null>(null);
  const [isRenameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const coarsePointer = useCoarsePointer();

  const openNodeActionsMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = getNodeContextMenuAnchor(rect);
    // Re-dispatch the same native contextmenu event React Flow already listens for, so the
    // existing node context menu opens at the button — no forked menu contents.
    dispatchNodeContextMenu(containerRef.current, anchor.clientX, anchor.clientY);
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('contextmenu', close);

    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!isRenameOpen) {
      return;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [isRenameOpen]);

  const openRenamePanel = () => {
    if (!nodeId) {
      return;
    }

    setRenameDraft(currentBookmarkTitle || displayTitle);
    setRenameOpen(true);
    setContextMenu(null);
  };

  const commitRename = () => {
    if (!nodeId) {
      return;
    }

    renameNodeBookmark(nodeId, renameDraft);
    setRenameOpen(false);
  };

  const clearRename = () => {
    if (!nodeId) {
      return;
    }

    clearNodeBookmark(nodeId);
    setRenameDraft('');
    setRenameOpen(false);
  };

  const openTitleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (!nodeId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'rename-node-title',
          label: currentBookmarkTitle ? 'Edit Bookmark Name' : 'Rename And Bookmark',
          action: openRenamePanel,
        },
        {
          id: 'clear-node-title',
          label: 'Remove Bookmark',
          disabled: !currentBookmarkTitle,
          action: clearRename,
        },
      ],
    });
  };
const LOGIC_NODE_TYPES = useMemo(() => new Set<FlowNodeType>([
  'switchNode',
  'forkSwitchNode',
  'logicNode',
  'conditionalNode',
  'comparisonNode',
  'visionVerifyNode',
  'loopGateNode',
  'mathNode',
  'listLengthNode',
  'valueMonitorNode'
]), []);
const GENERIC_INPUT_TYPES = useMemo(() => new Set<FlowNodeType>([
  'valueMonitorNode',
  'loopGateNode'
]), []);
const GENERIC_OUTPUT_TYPES = useMemo(() => new Set<FlowNodeType>([
  'switchNode',
  'forkSwitchNode',
  'conditionalNode',
  'loopGateNode',
  'valueMonitorNode',
  'fallbackSelectorNode',
  'switchCaseNode'
]), []);
const LOOP_BREAK_TARGET_TYPES = useMemo(() => new Set<FlowNodeType>([
  'textNode',
  'imageGen',
  'cropImageNode',
  'videoGen',
  'audioGen',
  'composition',
  'visionVerifyNode',
  'functionNode',
]), []);

const isLogicNode = nodeType && LOGIC_NODE_TYPES.has(nodeType);
const isGenericInput = nodeType && GENERIC_INPUT_TYPES.has(nodeType);
const isGenericOutput = nodeType && GENERIC_OUTPUT_TYPES.has(nodeType);
const acceptsLoopBreak = nodeType && LOOP_BREAK_TARGET_TYPES.has(nodeType);

const inputShapeClass = isGenericInput ? 'sl-handle-triangle' : (isLogicNode ? '!rounded-none' : '!rounded-full');
const outputShapeClass = isGenericOutput ? 'sl-handle-triangle' : (isLogicNode ? '!rounded-none' : '!rounded-full');

return (
  <FlowNodeHandleContext.Provider value={nodeId ?? null}>
  <div
    ref={containerRef}
    aria-keyshortcuts={nodeId ? 'Enter Space' : undefined}
    aria-label={nodeId ? `${displayTitle} node` : undefined}
    className={`border rounded-xl w-[260px] shadow-2xl font-sans relative flex flex-col group transition-all hover:border-gray-500 ${theme.containerClassName} ${containerClassName ?? ''}`}
    onKeyDown={(event) => {
      // React Flow owns selection on the outer node wrapper. Mirror a pointer click for the
      // keyboard-operable inner landmark, while leaving text fields and other controls alone.
      if (!nodeId || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
        return;
      }

      event.preventDefault();
      event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }}
    role={nodeId ? 'group' : undefined}
    style={containerStyle}
    tabIndex={nodeId ? 0 : undefined}
  >

    {hasInput && (
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-6 !h-6 !border-[3px] !border-[#1e2027] !-ml-3 ${inputShapeClass}`}
        style={{ backgroundColor: theme.accentColor }}
      />
    )}

      {acceptsLoopBreak && showLoopBreak ? (
        <Handle
          type="target"
          position={Position.Left}
          id={LOOP_BREAK_TARGET_HANDLE}
          className="!h-4 !w-4 !rounded-sm !border-2 !border-[#1e2027] !bg-rose-400"
          style={{ top: '86%', left: -8 }}
          title="Stop/break this batch when connected Stop When is true"
        />
      ) : null}

      {customHandles}

      {/* Header */}
      <div className={`flex justify-between items-center px-3 py-2 rounded-t-xl border-b backdrop-blur-md ${theme.headerClassName}`}>
        <div className="flex items-center gap-2 overflow-hidden">
          <Icon size={14} className={`${theme.iconClassName} shrink-0`} />
          <span
            className={withFlowNodeInteractionClasses(`text-xs font-semibold text-gray-200 tracking-wide line-clamp-2 ${nodeId ? 'cursor-context-menu' : ''}`)}
            onContextMenu={(event) => {
              if (shouldOpenNodeTitleContextMenu({ nodeSelected: currentNodeSelected, target: event.target })) {
                openTitleContextMenu(event);
              }
            }}
            title={nodeId ? 'Right-click for node title actions' : undefined}
          >
            {displayTitle}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {nodeId ? (
            <button
              aria-label="Node actions"
              className={withFlowNodeInteractionClasses(`rounded-md border border-gray-700/60 bg-[#111217]/40 p-1 text-gray-400 transition-all hover:border-gray-500 hover:text-white focus-visible:opacity-100 ${
                coarsePointer || currentNodeSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`)}
              onClick={openNodeActionsMenu}
              onContextMenu={openNodeActionsMenu}
              onPointerDown={(event) => event.stopPropagation()}
              title="Node actions"
              type="button"
            >
              <MoreHorizontal size={12} />
            </button>
          ) : null}
          {nodeId ? (
            <button
              aria-label={currentBookmarkTitle ? 'Edit node bookmark' : 'Rename and bookmark node'}
              className={withFlowNodeInteractionClasses(`rounded-md border p-1 transition-colors ${
                currentBookmarkTitle
                  ? 'border-fuchsia-400/45 bg-fuchsia-400/15 text-fuchsia-100 hover:border-fuchsia-300'
                  : 'border-gray-700/60 bg-[#111217]/40 text-gray-400 hover:border-gray-500 hover:text-white'
              }`)}
              onClick={(event) => {
                event.stopPropagation();
                openRenamePanel();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title={currentBookmarkTitle ? 'Edit node bookmark' : 'Rename and bookmark node'}
              type="button"
            >
              {currentBookmarkTitle ? <Bookmark size={12} fill="currentColor" /> : <Bookmark size={12} />}
            </button>
          ) : null}
          {onToggleCollapsed ? (
          <button
            aria-label={isCollapsed ? 'Expand node' : 'Collapse node'}
            className={withFlowNodeInteractionClasses('rounded-md border border-gray-700/60 bg-[#111217]/40 p-1 text-gray-400 transition-colors hover:border-gray-500 hover:text-white')}
            onClick={onToggleCollapsed}
            type="button"
          >
            {isCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          </button>
          ) : null}
        </div>
      </div>

      {isRenameOpen ? (
        <div
          className={withFlowNodeInteractionClasses('absolute right-2 top-11 z-[90] w-64 rounded-xl border border-fuchsia-300/25 bg-[#10151f]/98 p-3 shadow-2xl backdrop-blur')}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-100/60">
            Bookmark Name
          </label>
          <input
            ref={renameInputRef}
            className="mt-2 w-full rounded-lg border border-gray-700/70 bg-[#080d14] px-2.5 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-fuchsia-300/70"
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setRenameOpen(false);
              }
            }}
            value={renameDraft}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300/35 bg-fuchsia-400/15 px-2.5 py-1.5 text-xs font-semibold text-fuchsia-50 transition-colors hover:border-fuchsia-200/70"
              onClick={commitRename}
              type="button"
            >
              <Check size={13} />
              Save
            </button>
            <div className="flex items-center gap-1.5">
              {currentBookmarkTitle ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/70 bg-[#111217]/50 px-2 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:border-red-300/50 hover:text-red-100"
                  onClick={clearRename}
                  type="button"
                >
                  <Trash2 size={13} />
                  Clear
                </button>
              ) : null}
              <button
                aria-label="Cancel bookmark rename"
                className="rounded-lg border border-gray-700/70 bg-[#111217]/50 p-1.5 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
                onClick={() => setRenameOpen(false)}
                type="button"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Content */}
      <div className="p-3 flex flex-col gap-3">
        {retryState ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100 flex items-start gap-2">
            <Clock size={14} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Retrying {retryState.attempt} of {retryState.max}...</div>
              {statusMessage && <div className="mt-0.5 text-amber-100/70">{statusMessage}</div>}
            </div>
          </div>
        ) : statusMessage ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-100">
            {statusMessage}
          </div>
        ) : null}

        {error && !retryState ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-100">
            {error}
          </div>
        ) : null}

        {visibleContent}
      </div>

      {/* Footer / Actions */}
      {hasFooter && (
        <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {listLoopSummary ? (
              <label
                className={withFlowNodeInteractionClasses('flex min-w-0 items-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#111217]/45 px-2 py-1 text-[10px] font-semibold text-gray-300')}
                title={`${listLoopSummary.inputCount} connected list inputs`}
              >
                <span className="shrink-0 uppercase tracking-[0.14em] text-gray-500">Loop</span>
                <select
                  aria-label="List loop mode"
                  className={withFlowNodeInteractionClasses('w-[82px] border-0 bg-transparent p-0 text-[10px] font-semibold text-gray-100 outline-none')}
                  onChange={(event) => {
                    if (!nodeId) {
                      return;
                    }

                    patchNodeData(nodeId, {
                      listLoopMode: event.target.value === 'allCombinations' ? 'allCombinations' : 'paired',
                    });
                  }}
                  value={currentListLoopMode}
                >
                  <option value="paired">Paired</option>
                  <option value="allCombinations">All Combos</option>
                </select>
                <span className="shrink-0 text-gray-500">
                  {activeLoopRunCount === undefined ? 'fix' : `${activeLoopRunCount}x`}
                </span>
              </label>
            ) : null}
            {footerActions}
          </div>

          {onRun ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onRun}
                disabled={isRunning || Boolean(runDisabledReason)}
                className={withFlowNodeInteractionClasses(`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                  ${isRunning || runDisabledReason
                    ? 'bg-blue-600/50 text-white cursor-not-allowed'
                    : 'bg-white text-black hover:bg-gray-200 shadow-sm'
                  }`)}
                title={runDisabledReason}
                type="button"
              >
                {isRunning ? (
                  <RotateCcw size={12} className="animate-spin" />
                ) : (
                  <Play size={12} fill="currentColor" />
                )}
                {isRunning ? 'Running' : 'Run'}
              </button>
              {isRunning && nodeId ? (
                <button
                  aria-label="Cancel node run"
                  className={withFlowNodeInteractionClasses('flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/20')}
                  onClick={() => cancelNodeRun(nodeId)}
                  title="Cancel run"
                  type="button"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {hasOutput && (
        nodeId ? (
          <OutputPortMenu
            accentColor={theme.accentColor}
            actions={outputActions}
            hoverAccentColor={theme.hoverAccentColor}
            nodeId={nodeId}
            isLogicNode={isLogicNode}
            isGenericOutput={isGenericOutput}
          />
        ) : (
          <Handle
            type="source"
            position={Position.Right}
            className={`!w-6 !h-6 !border-[3px] !border-[#1e2027] !-mr-3 ${outputShapeClass}`}
            style={{ backgroundColor: theme.accentColor }}
          />
        )
      )}
      {contextMenu ? (
        <SharedContextMenu
          ariaLabel="Node title context menu"
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
          title="Node Actions"
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}
    </div>
  </FlowNodeHandleContext.Provider>
  );
};
