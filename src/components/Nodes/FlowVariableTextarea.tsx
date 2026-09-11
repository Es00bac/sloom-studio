import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import {
  applyFlowVariableAutocompleteSuggestion,
  collectFlowVariableBindings,
  getFlowVariableAutocompleteState,
  type FlowVariableBinding,
  type FlowVariableAutocompleteState,
} from '../../lib/flowVariables';
import { useFlowStore } from '../../store/flowStore';

interface FlowVariableTextareaProps {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  rows?: number;
  expandedTitle?: string;
  defaultExpanded?: boolean;
}

interface FlowVariableReferenceToken {
  insertText: string;
  label: string;
  kind: string;
}

interface FlowVariableReferenceGroup {
  name: string;
  label: string;
  kind: string;
  tokens: FlowVariableReferenceToken[];
}

export function FlowVariableTextarea({
  value,
  onChange,
  className,
  placeholder,
  rows,
  expandedTitle,
  defaultExpanded = false,
}: FlowVariableTextareaProps) {
  const compactTextareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const storeNodes = useFlowStore((state) => state.nodes);
  const storeEdges = useFlowStore((state) => state.edges);
  const nodes = typeof window === 'undefined' ? useFlowStore.getState().nodes : storeNodes;
  const edges = typeof window === 'undefined' ? useFlowStore.getState().edges : storeEdges;
  const bindings = useMemo(() => collectFlowVariableBindings(nodes, edges), [edges, nodes]);
  const referenceGroups = useMemo(() => buildFlowVariableReferenceGroups(bindings), [bindings]);
  const [autocomplete, setAutocomplete] = useState<FlowVariableAutocompleteState | undefined>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeEditor, setActiveEditor] = useState<'compact' | 'expanded'>('compact');
  const [isExpanded, setExpanded] = useState(defaultExpanded);
  const [expandedSelection, setExpandedSelection] = useState({ start: value.length, end: value.length });

  const refreshAutocomplete = (nextValue: string, cursorIndex: number) => {
    const nextState = getFlowVariableAutocompleteState(nextValue, cursorIndex, bindings);
    setAutocomplete(nextState);
    setActiveIndex(0);
  };

  const insertSuggestion = (index: number) => {
    const suggestion = autocomplete?.suggestions[index];
    if (!autocomplete || !suggestion) return;

    const result = applyFlowVariableAutocompleteSuggestion(value, autocomplete.replaceRange, suggestion.insertText);
    onChange(result.text);
    setAutocomplete(undefined);
    window.requestAnimationFrame(() => {
      const textarea = activeEditor === 'expanded' ? expandedTextareaRef.current : compactTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(result.cursorIndex, result.cursorIndex);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, editor: 'compact' | 'expanded') => {
    setActiveEditor(editor);

    if (!autocomplete || autocomplete.suggestions.length === 0) {
      if (editor === 'expanded' && event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % autocomplete.suggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + autocomplete.suggestions.length) % autocomplete.suggestions.length);
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertSuggestion(activeIndex);
      return;
    }

    if (event.key === 'Escape') {
      setAutocomplete(undefined);
    }
  };

  const openExpandedEditor = () => {
    setExpanded(true);
    setActiveEditor('expanded');
    window.requestAnimationFrame(() => {
      const textarea = expandedTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  };

  const renderEditor = (editor: 'compact' | 'expanded') => {
    const isExpandedEditor = editor === 'expanded';
    const showAutocomplete = autocomplete && activeEditor === editor;

    return (
      <div className="relative">
        {expandedTitle && !isExpandedEditor ? (
          <button
            aria-label={`Open ${expandedTitle}`}
            className="absolute right-1.5 top-1.5 z-10 rounded-md border border-gray-700/60 bg-[#111217]/80 p-1 text-gray-300 shadow-lg transition-colors hover:border-blue-400/70 hover:text-white"
            onClick={openExpandedEditor}
            title={`Open ${expandedTitle}`}
            type="button"
          >
            <Maximize2 size={13} />
          </button>
        ) : null}
        <textarea
          className={isExpandedEditor
            ? 'min-h-[420px] w-full resize-y rounded-lg border border-gray-700/70 bg-[#0b0f17] p-3 font-mono text-sm leading-6 text-gray-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40'
            : className}
          data-flow-variable-expanded-textarea={isExpandedEditor ? 'true' : undefined}
          onBlur={() => window.setTimeout(() => setAutocomplete(undefined), 120)}
          onChange={(event) => {
            setActiveEditor(editor);
            if (isExpandedEditor) {
              setExpandedSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
            }
            onChange(event.target.value);
            refreshAutocomplete(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => {
            setActiveEditor(editor);
            if (isExpandedEditor) {
              setExpandedSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
            }
            refreshAutocomplete(value, event.currentTarget.selectionStart);
          }}
          onKeyDown={(event) => handleKeyDown(event, editor)}
          onKeyUp={(event) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
            setActiveEditor(editor);
            if (isExpandedEditor) {
              setExpandedSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
            }
            refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onSelect={(event) => {
            if (!isExpandedEditor) return;
            setExpandedSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
          }}
          placeholder={placeholder}
          ref={isExpandedEditor ? expandedTextareaRef : compactTextareaRef}
          rows={isExpandedEditor ? 18 : rows}
          value={value}
        />
        {showAutocomplete ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-cyan-300/25 bg-[#080b12] p-1 shadow-2xl shadow-black/50">
            {autocomplete.suggestions.map((suggestion, index) => (
              <button
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                  index === activeIndex ? 'bg-cyan-300/15 text-white' : 'text-gray-300 hover:bg-white/5'
                }`}
                data-flow-variable-suggestion="true"
                key={suggestion.insertText}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSuggestion(index);
                }}
                type="button"
              >
                <span className="truncate font-mono">{suggestion.insertText}</span>
                <span className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[9px] uppercase text-gray-400">
                  {suggestion.kind}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderExpandedDialog = () => {
    const dialog = (
      <div
        aria-modal="true"
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6"
        role="dialog"
      >
        <div className="flex max-h-[88vh] w-full max-w-5xl flex-col gap-3 rounded-xl border border-gray-700/70 bg-[#0b0d13] p-4 shadow-2xl shadow-black/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-100">{expandedTitle}</h2>
            <button
              aria-label={`Close ${expandedTitle}`}
              className="rounded-md border border-gray-700/70 bg-[#111217] p-1.5 text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
              onClick={() => setExpanded(false)}
              title={`Close ${expandedTitle}`}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-h-0 overflow-y-auto">
              {renderEditor('expanded')}
            </div>
            {referenceGroups.length > 0 ? (
              <aside
                className="min-h-0 overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#080b12] p-3"
                data-flow-variable-reference-rail="true"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/80">
                  Available Variables
                </div>
                <div className="mt-3 space-y-3">
                  {referenceGroups.map((group) => (
                    <div className="rounded-md border border-gray-800/80 bg-white/[0.03] p-2" key={group.name}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate font-mono text-[11px] text-white">{group.name}</div>
                        <div className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[9px] uppercase text-gray-400">
                          {group.kind}
                        </div>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-gray-500">{group.label}</div>
                      <div className="mt-2 space-y-1">
                        {group.tokens.map((token) => (
                          <button
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-800 bg-[#10141d] px-2 py-1.5 text-left text-[11px] text-gray-200 transition-colors hover:border-cyan-300/40 hover:text-white"
                            data-flow-variable-reference-button="true"
                            key={token.insertText}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              const start = Math.max(0, Math.min(value.length, expandedSelection.start));
                              const end = Math.max(start, Math.min(value.length, expandedSelection.end));
                              const nextText = `${value.slice(0, start)}${token.insertText}${value.slice(end)}`;
                              const nextCursor = start + token.insertText.length;

                              onChange(nextText);
                              setAutocomplete(undefined);
                              setActiveEditor('expanded');
                              setExpandedSelection({ start: nextCursor, end: nextCursor });
                              window.requestAnimationFrame(() => {
                                const nextTextarea = document.querySelector<HTMLTextAreaElement>('[data-flow-variable-expanded-textarea="true"]');
                                if (!nextTextarea) return;
                                nextTextarea.focus();
                                nextTextarea.setSelectionRange(nextCursor, nextCursor);
                              });
                            }}
                            title={`Insert ${token.insertText}`}
                            type="button"
                          >
                            <span className="truncate font-mono">{token.insertText}</span>
                            <span className="shrink-0 text-[9px] uppercase text-gray-500">{token.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    );

    return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
  };

  return (
    <>
      {renderEditor('compact')}
      {expandedTitle && isExpanded ? renderExpandedDialog() : null}
    </>
  );
}

function buildFlowVariableReferenceGroups(bindings: FlowVariableBinding[]): FlowVariableReferenceGroup[] {
  return bindings.map((binding) => {
    const hasItems = Array.isArray(binding.items) && binding.items.length > 0;
    const tokens: FlowVariableReferenceToken[] = hasItems
      ? [
        { insertText: `{{${binding.name}[*]}}`, label: 'all', kind: binding.kind },
        ...binding.items!.slice(0, 8).map((item) => ({
          insertText: `{{${binding.name}[${item.position}]}}`,
          label: `item ${item.position}`,
          kind: item.kind,
        })),
      ]
      : [{ insertText: `{{${binding.name}}}`, label: 'value', kind: binding.kind }];

    return {
      name: binding.name,
      label: binding.label,
      kind: binding.kind,
      tokens,
    };
  });
}
