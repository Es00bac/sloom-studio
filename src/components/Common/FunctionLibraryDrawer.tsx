import { useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import type { StandardLibraryFunction } from '../../lib/standardLibrary';

interface FunctionLibraryDrawerProps {
  open: boolean;
  builtInFunctions: StandardLibraryFunction[];
  customFunctions: StandardLibraryFunction[];
  onClose: () => void;
  onInsertBuiltIn: (func: StandardLibraryFunction) => void;
  onInsertCustom: (func: StandardLibraryFunction) => void;
}

export function FunctionLibraryDrawer({
  open,
  builtInFunctions,
  customFunctions,
  onClose,
  onInsertBuiltIn,
  onInsertCustom,
}: FunctionLibraryDrawerProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const sections = useMemo(() => {
    const filter = (func: StandardLibraryFunction) => {
      if (!normalizedQuery) {
        return true;
      }
      return [
        func.name,
        func.description,
        func.usage ?? '',
        ...(func.tags ?? []),
        ...(func.inputPorts ?? []).map((port) => `${port.label} ${port.key} ${port.description ?? ''}`),
        ...(func.outputPorts ?? []).map((port) => `${port.label} ${port.key} ${port.description ?? ''}`),
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    };

    return {
      builtIn: builtInFunctions.filter(filter),
      custom: customFunctions.filter(filter),
    };
  }, [builtInFunctions, customFunctions, normalizedQuery]);

  if (!open) {
    return null;
  }

  return (
    <aside className="fixed right-4 top-20 z-[85] flex h-[min(760px,calc(100vh-112px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-emerald-300/25 bg-[#07120f]/98 text-cyan-50 shadow-2xl shadow-black/45 backdrop-blur-xl">
      <header className="border-b border-emerald-300/20 bg-emerald-300/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-200">
              <BookOpen size={16} />
              Function Library
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-50/70">
              Insert reusable story, media, logic, and custom collapsed functions as single configurable nodes.
            </p>
          </div>
          <button
            className="rounded-lg border border-emerald-300/20 p-2 text-emerald-100/70 transition-colors hover:border-emerald-100/70 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-black/25 px-3 py-2">
          <Search size={15} className="text-emerald-200/70" />
          <input
            className="w-full bg-transparent text-sm text-emerald-50 outline-none placeholder:text-emerald-100/35"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search functions, tags, inputs, outputs..."
            type="search"
            value={query}
          />
        </label>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <FunctionSection
          emptyLabel="No built-in functions match this search."
          functions={sections.builtIn}
          label="Built-in AI and logic functions"
          onInsert={onInsertBuiltIn}
        />
        <FunctionSection
          emptyLabel="No custom functions yet. Select nodes on the canvas, right-click, and collapse them into a reusable function."
          functions={sections.custom}
          label="Custom project functions"
          onInsert={onInsertCustom}
        />
      </div>
    </aside>
  );
}

function FunctionSection({
  emptyLabel,
  functions,
  label,
  onInsert,
}: {
  emptyLabel: string;
  functions: StandardLibraryFunction[];
  label: string;
  onInsert: (func: StandardLibraryFunction) => void;
}) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100/55">{label}</div>
      <div className="space-y-2">
        {functions.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-cyan-100/45">
            {emptyLabel}
          </div>
        ) : functions.map((func) => (
          <button
            className="w-full rounded-xl border border-emerald-300/15 bg-[#0b1b18]/85 p-3 text-left transition-colors hover:border-emerald-200/60 hover:bg-emerald-300/10"
            key={`${func.source ?? 'built-in'}-${func.id}`}
            onClick={() => onInsert(func)}
            type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{func.name}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-cyan-100/60">{func.description}</p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-300/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-100/70">
                {func.source ?? 'built-in'}
              </span>
            </div>
            {func.usage ? (
              <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] leading-5 text-emerald-50/70">
                {func.usage}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1">
              {(func.tags ?? []).map((tag) => (
                <span className="rounded bg-emerald-300/10 px-1.5 py-0.5 text-[10px] text-emerald-100/75" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
