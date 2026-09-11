import { useMemo, useState } from 'react';
import { LayoutTemplate, Search, Sparkles } from 'lucide-react';
import {
  findFlowStarterTemplates,
  getStarterTemplatePreviewModel,
  starterTemplateDescription,
  starterTemplateLabel,
  starterTemplateNodeCount,
  starterTemplateRunRequirement,
  type FlowStarterTemplate,
} from '../../lib/flowStarterTemplates';
import { useI18n } from '../../lib/useI18n';

export interface FlowStarterGalleryProps {
  onInsert: (templateId: string) => void;
  /** `panel` is the actionable empty-canvas surface; `menu` is the compact toolbar popover. */
  variant?: 'panel' | 'menu';
}

/**
 * Built-in Flow starter-template gallery (MH-094). Every card shows a
 * deterministic miniature graph preview, a human-readable description, and a
 * node count. Inserting runs the shared callback, which places the template
 * through the store's insertTemplate action.
 */
export function FlowStarterGallery({ onInsert, variant = 'panel' }: FlowStarterGalleryProps) {
  const { t, tf, locale } = useI18n();
  const [query, setQuery] = useState('');
  const templates = useMemo(() => findFlowStarterTemplates(query), [query]);

  if (variant === 'menu') {
    return (
      <div data-keyboard-focus-scope="true" data-starter-template-menu-panel="true">
        <StarterTemplateSearch onChange={setQuery} value={query} />
        <StarterTemplateList
          emptyLabel={t('flow.starter.noMatches')}
          listClassName="max-h-[52vh]"
          locale={locale}
          onInsert={onInsert}
          templates={templates}
          tf={tf}
        />
      </div>
    );
  }

  return (
    <section
      aria-label={t('flow.starter.panelTitle')}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4"
      data-keyboard-focus-scope="true"
      data-starter-template-panel="true"
    >
      <div className="theme-popover pointer-events-auto flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-gray-700 bg-[#141821] p-5 shadow-2xl">
        <header className="flex shrink-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 text-fuchsia-200">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-100">{t('flow.starter.panelTitle')}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">{t('flow.starter.panelDescription')}</p>
          </div>
        </header>
        <div className="mt-4 shrink-0">
          <StarterTemplateSearch onChange={setQuery} value={query} />
        </div>
        <StarterTemplateList
          emptyLabel={t('flow.starter.noMatches')}
          listClassName="min-h-0 flex-1"
          locale={locale}
          onInsert={onInsert}
          templates={templates}
          tf={tf}
        />
      </div>
    </section>
  );
}

function StarterTemplateSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
      <input
        aria-label={t('flow.starter.searchLabel')}
        className="w-full rounded-lg border border-gray-700 bg-[#0d1118] py-2 pl-8 pr-3 text-xs text-gray-200 placeholder:text-gray-500 focus:border-cyan-400/60 focus:outline-none"
        data-starter-template-search="true"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('flow.starter.searchPlaceholder')}
        type="search"
        value={value}
      />
    </div>
  );
}

function StarterTemplateList({
  templates,
  onInsert,
  locale,
  tf,
  emptyLabel,
  listClassName,
}: {
  templates: FlowStarterTemplate[];
  onInsert: (templateId: string) => void;
  locale: ReturnType<typeof useI18n>['locale'];
  tf: ReturnType<typeof useI18n>['tf'];
  emptyLabel: string;
  /** Bounds the scrollable list height; differs between the fixed-width popover and the flex-col empty-canvas panel. */
  listClassName: string;
}) {
  const { t } = useI18n();
  if (templates.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-gray-700/60 bg-[#0d1118] px-3 py-4 text-center text-xs text-gray-400" data-starter-template-empty="true">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className={`mt-3 grid auto-rows-min gap-2 overflow-y-auto pr-1 sm:grid-cols-2 ${listClassName}`} data-starter-template-list="true">
      {templates.map((template) => {
        const label = starterTemplateLabel(template, locale);
        const requirement = starterTemplateRunRequirement(template);
        return (
          <li key={template.id}>
            <button
              aria-label={tf('flow.starter.add', { name: label })}
              className="group flex w-full flex-col gap-2 rounded-xl border border-gray-700/70 bg-[#0d1118] p-2.5 text-left transition-colors hover:border-cyan-300/50 hover:bg-cyan-400/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300/70"
              data-starter-template-card={template.id}
              onClick={() => onInsert(template.id)}
              type="button"
            >
              <StarterTemplatePreview template={template} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-gray-100">{label}</span>
                  <span className="shrink-0 rounded border border-gray-700/70 bg-[#10151f] px-1.5 py-0.5 text-[10px] font-semibold text-gray-400">
                    {tf('flow.starter.nodeCount', { count: starterTemplateNodeCount(template) })}
                  </span>
                </span>
                <span className="mt-1 line-clamp-3 text-[11px] leading-4 text-gray-400">
                  {starterTemplateDescription(template, locale)}
                </span>
                <span
                  className={
                    requirement === 'provider'
                      ? 'mt-1 text-[11px] font-medium leading-4 text-amber-300/90'
                      : 'mt-1 text-[11px] font-medium leading-4 text-emerald-300/80'
                  }
                  data-starter-template-requirement={requirement}
                >
                  {requirement === 'provider' ? t('flow.starter.requiresProvider') : t('flow.starter.runsLocally')}
                </span>
                <span className="mt-auto pt-1.5 text-[11px] font-semibold text-cyan-300/80 opacity-80 transition-opacity group-hover:opacity-100">
                  <LayoutTemplate aria-hidden="true" className="mr-1 inline align-[-2px]" size={12} />
                  {tf('flow.starter.add', { name: label })}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StarterTemplatePreview({ template }: { template: FlowStarterTemplate }) {
  const model = useMemo(() => getStarterTemplatePreviewModel(template), [template]);
  return (
    <svg
      aria-hidden="true"
      className="block w-full rounded-lg border border-gray-700/60 bg-[#0a0e16]"
      data-starter-template-preview={template.id}
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${model.width} / ${model.height}` }}
      viewBox={`0 0 ${model.width} ${model.height}`}
    >
      {model.edges.map((edge, index) => (
        <path
          d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`}
          fill="none"
          key={index}
          stroke="#3f4a5f"
          strokeWidth={1.5}
        />
      ))}
      {model.nodes.map((node, index) => (
        <rect
          fill="#141b29"
          height={node.height}
          key={index}
          rx={4}
          stroke={node.color}
          strokeWidth={1.4}
          width={node.width}
          x={node.x}
          y={node.y}
        />
      ))}
    </svg>
  );
}
