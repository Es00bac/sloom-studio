import { useId, useMemo, useState } from 'react';
import { Keyboard, Search } from 'lucide-react';
import type { AppLocale } from '../../../lib/i18n';
import type { KeyboardShortcutMap } from '../../../lib/keyboardShortcuts';
import {
  buildPaperShortcutCatalog,
  countPaperShortcuts,
  filterPaperShortcutCatalog,
  type PaperShortcutCatalogLabels,
} from './paperShortcutCatalog';

export interface PaperShortcutHelpPanelLabels extends PaperShortcutCatalogLabels {
  title: string;
  description: string;
  searchLabel: string;
  searchPlaceholder: string;
  noResults: string;
  count: (value: number) => string;
}

const DEFAULT_PAPER_SHORTCUT_HELP_LABELS: PaperShortcutHelpPanelLabels = {
  title: 'Paper shortcuts',
  description: 'Command shortcuts follow your Keyboard settings. Canvas and text gestures are context-specific.',
  searchLabel: 'Search Paper shortcuts',
  searchPlaceholder: 'Search commands, keys, or groups',
  noResults: 'No Paper shortcuts match this search.',
  count: (value) => `${value} shortcut${value === 1 ? '' : 's'}`,
  canvasGroup: 'Canvas',
  textEditingGroup: 'Text editing',
};

export function PaperShortcutHelpPanel({
  labels = DEFAULT_PAPER_SHORTCUT_HELP_LABELS,
  locale = 'en',
  shortcuts = {},
}: {
  labels?: PaperShortcutHelpPanelLabels;
  locale?: AppLocale;
  shortcuts?: KeyboardShortcutMap;
}) {
  const [query, setQuery] = useState('');
  const headingId = useId();
  const descriptionId = useId();
  const searchId = useId();
  const groups = useMemo(
    () => buildPaperShortcutCatalog(shortcuts, locale, labels),
    [labels, locale, shortcuts],
  );
  const filteredGroups = useMemo(
    () => filterPaperShortcutCatalog(groups, query),
    [groups, query],
  );
  const resultCount = countPaperShortcuts(filteredGroups);

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col bg-[#151720] text-cyan-50"
      data-paper-shortcut-help="true"
    >
      <header className="shrink-0 border-b border-[#2a2e3c] px-3 py-3">
        <div className="flex items-center gap-2">
          <Keyboard aria-hidden="true" className="h-4 w-4 text-cyan-300/80" />
          <h2 className="text-sm font-semibold" id={headingId}>{labels.title}</h2>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-cyan-100/50" id={descriptionId}>
          {labels.description}
        </p>
        <div className="relative mt-3" role="search">
          <label className="sr-only" htmlFor={searchId}>{labels.searchLabel}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-100/35" />
          <input
            autoComplete="off"
            className="h-8 w-full rounded border border-[#303646] bg-[#0d1017] pl-8 pr-2 text-xs text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/60 focus:ring-1 focus:ring-cyan-300/25"
            id={searchId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            type="search"
            value={query}
          />
        </div>
        <p aria-live="polite" className="mt-1.5 text-[10px] text-cyan-100/40" role="status">
          {labels.count(resultCount)}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {filteredGroups.map((group) => {
          const groupHeadingId = `${headingId}-${group.id.replaceAll(/[^a-z0-9-]/gi, '-')}`;
          return (
            <section aria-labelledby={groupHeadingId} className="py-2" key={group.id}>
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/55" id={groupHeadingId}>
                {group.label}
              </h3>
              <ul className="space-y-1" role="list">
                {group.items.map((item) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded border border-transparent px-2 py-1.5 hover:border-cyan-300/10 hover:bg-cyan-300/5"
                    data-paper-shortcut-id={item.id}
                    key={item.id}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium leading-4 text-cyan-50/85">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 block text-[10px] leading-3.5 text-cyan-100/40">{item.description}</span>
                      ) : null}
                    </span>
                    <kbd
                      aria-label={`${item.label}: ${item.shortcut}`}
                      className="max-w-32 rounded border border-cyan-300/15 bg-black/25 px-1.5 py-0.5 text-right font-mono text-[10px] leading-4 text-cyan-100/65"
                    >
                      {displayPaperShortcut(item.shortcut)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {resultCount === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-cyan-100/45">{labels.noResults}</p>
        ) : null}
      </div>
    </section>
  );
}

/** Ctrl in the shared settings map is intentionally Ctrl-or-Command at runtime. */
function displayPaperShortcut(shortcut: string): string {
  return shortcut.replaceAll(/(^|\+)Ctrl(?=\+|$)/g, '$1Ctrl/Cmd');
}
