import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';

/**
 * Persisted, dismissible node help text (UX review F06).
 *
 * Several node types render the same multi-line explainer on every instance, which eats
 * canvas space. `NodeHelpText` collapses that prose to a compact one-line "?" hint by
 * default and lets the user expand it on demand. The expanded/collapsed choice is keyed
 * by `helpKey` (usually the node type) and persisted in localStorage, so a preference set
 * on one node applies to every node that shares the key and survives reloads.
 *
 * State lives in a Flow-side localStorage helper rather than a shared settings store to
 * respect the workspace territory split.
 */

const STORAGE_KEY = 'signal-loom:flow:node-help-expanded';

type HelpExpandedState = Record<string, boolean>;

export function readNodeHelpExpandedState(): HelpExpandedState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const result: HelpExpandedState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function isNodeHelpExpanded(helpKey: string, defaultExpanded = false): boolean {
  const state = readNodeHelpExpandedState();
  return Object.prototype.hasOwnProperty.call(state, helpKey) ? state[helpKey] : defaultExpanded;
}

export function writeNodeHelpExpanded(helpKey: string, expanded: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const state = readNodeHelpExpandedState();
    state[helpKey] = expanded;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore serialization / quota failures — the help preference is non-critical.
  }
}

export function useNodeHelpExpanded(
  helpKey: string,
  defaultExpanded = false,
): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState(() => isNodeHelpExpanded(helpKey, defaultExpanded));

  useEffect(() => {
    setExpanded(isNodeHelpExpanded(helpKey, defaultExpanded));
  }, [helpKey, defaultExpanded]);

  const update = useCallback(
    (next: boolean) => {
      setExpanded(next);
      writeNodeHelpExpanded(helpKey, next);
    },
    [helpKey],
  );

  return [expanded, update];
}

interface NodeHelpTextProps {
  /** Persistence key, usually the node type. Nodes sharing a key share the collapsed state. */
  helpKey: string;
  /** One-line hint shown in the collapsed state. */
  summary?: string;
  /** Full help content, shown when expanded. */
  children: ReactNode;
  /** Start expanded the first time (before the user has toggled). Defaults to collapsed. */
  defaultExpanded?: boolean;
  /** Extra classes for the expanded content wrapper. */
  className?: string;
}

export function NodeHelpText({
  helpKey,
  summary = 'What is this node?',
  children,
  defaultExpanded = false,
  className,
}: NodeHelpTextProps) {
  const [expanded, setExpanded] = useNodeHelpExpanded(helpKey, defaultExpanded);

  if (!expanded) {
    return (
      <button
        aria-expanded={false}
        aria-label="Show node help"
        className={withFlowNodeInteractionClasses(
          'flex w-full items-center gap-1.5 rounded-md border border-gray-700/50 bg-[#111217]/40 px-2 py-1 text-[11px] text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300',
        )}
        data-node-help-key={helpKey}
        data-node-help-state="collapsed"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <HelpCircle size={12} className="shrink-0" />
        <span className="truncate text-left">{summary}</span>
      </button>
    );
  }

  return (
    <div
      className={`relative leading-5 text-gray-400 ${className ?? ''}`}
      data-node-help-key={helpKey}
      data-node-help-state="expanded"
    >
      <button
        aria-expanded
        aria-label="Hide node help"
        className={withFlowNodeInteractionClasses(
          'absolute -right-1 -top-1 rounded-md border border-gray-700/50 bg-[#111217]/70 p-0.5 text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-200',
        )}
        data-node-help-key={helpKey}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <X size={11} />
      </button>
      <div className="pr-5">{children}</div>
    </div>
  );
}
