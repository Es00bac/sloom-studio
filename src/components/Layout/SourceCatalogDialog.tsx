import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Search, Sparkles, Trash2, X } from 'lucide-react';
import { searchSourceCatalog } from '../../lib/sourceCatalog';
import type { EditorSourceKind } from '../../types/flow';
import { useSourceCatalogStore } from '../../store/sourceCatalogStore';
import { useI18n } from '../../lib/useI18n';

/**
 * Cross-project Source Library catalogue dialog (MH-085). Shows the bounded
 * metadata index recorded from every project saved or opened on this device:
 * search across projects, project/kind/generated filters, provenance, and
 * same-source lineage. Asset bytes stay in their own project; the dialog says
 * so explicitly instead of implying a cross-project copy exists.
 */
export function SourceCatalogDialog({ onClose }: { onClose: () => void }) {
  const { t, tf, locale } = useI18n();
  const records = useSourceCatalogStore((state) => state.records);
  const activeProjectId = useSourceCatalogStore((state) => state.activeProjectId);
  const activeProjectName = useSourceCatalogStore((state) => state.activeProjectName);
  const forgetProject = useSourceCatalogStore((state) => state.forgetProject);
  const clearCatalogue = useSourceCatalogStore((state) => state.clearCatalogue);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [generatedFilter, setGeneratedFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    searchInputRef.current?.focus();
    return () => {
      const element = restoreFocusRef.current;
      if (element instanceof HTMLElement) {
        element.focus();
      }
    };
  }, []);

  const outcome = useMemo(() => searchSourceCatalog(records, {
    text: query,
    projectId: projectFilter || undefined,
    kind: (kindFilter || undefined) as EditorSourceKind | undefined,
    generated: generatedFilter === '' ? undefined : generatedFilter === 'generated',
  }), [records, query, projectFilter, kindFilter, generatedFilter]);

  const totalItems = useMemo(
    () => records.reduce((sum, record) => sum + record.entries.length, 0),
    [records],
  );
  const projectNameByFilterId = useMemo(
    () => new Map(records.map((record) => [record.projectId, record.projectName])),
    [records],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="source-catalog-title"
        aria-modal="true"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-700/70 bg-[#10151f] p-4 shadow-2xl"
        data-source-catalog-dialog="true"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              {t('sourceCatalog.subtitle')}
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-white" id="source-catalog-title">
              {t('sourceCatalog.title')}
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              {tf('sourceCatalog.summary', { projects: records.length, items: totalItems })}
            </p>
          </div>
          <button
            aria-label={t('sourceCatalog.close')}
            className="rounded-lg border border-gray-700/60 px-2 py-1 text-xs text-gray-300 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={14} className="inline align-[-2px]" />
            {' '}
            {t('sourceCatalog.close')}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
            <input
              aria-label={t('sourceCatalog.searchLabel')}
              className="w-full rounded-lg border border-gray-700 bg-[#0d1118] py-2 pl-8 pr-3 text-xs text-gray-200 placeholder:text-gray-500 focus:border-cyan-400/60 focus:outline-none"
              data-source-catalog-search="true"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sourceCatalog.searchPlaceholder')}
              ref={searchInputRef}
              type="search"
              value={query}
            />
          </div>
          <select
            aria-label={t('sourceCatalog.projectFilter')}
            className="rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-2 text-xs text-gray-200 focus:border-cyan-400/60 focus:outline-none"
            data-source-catalog-project-filter="true"
            onChange={(event) => setProjectFilter(event.target.value)}
            value={projectFilter}
          >
            <option value="">{t('sourceCatalog.allProjects')}</option>
            {records.map((record) => (
              <option key={record.projectId} value={record.projectId}>
                {record.projectId === activeProjectId
                  ? tf('sourceCatalog.activeProjectName', { name: record.projectName })
                  : record.projectName}
              </option>
            ))}
          </select>
          <select
            aria-label={t('sourceCatalog.kindFilter')}
            className="rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-2 text-xs text-gray-200 focus:border-cyan-400/60 focus:outline-none"
            data-source-catalog-kind-filter="true"
            onChange={(event) => setKindFilter(event.target.value)}
            value={kindFilter}
          >
            <option value="">{t('sourceCatalog.allKinds')}</option>
            {(['text', 'image', 'video', 'audio', 'composition', 'document', 'subtitle', 'package'] as const).map((kind) => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select>
          <select
            aria-label={t('sourceCatalog.generatedFilter')}
            className="rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-2 text-xs text-gray-200 focus:border-cyan-400/60 focus:outline-none"
            data-source-catalog-generated-filter="true"
            onChange={(event) => setGeneratedFilter(event.target.value)}
            value={generatedFilter}
          >
            <option value="">{t('sourceCatalog.allOrigins')}</option>
            <option value="generated">{t('sourceCatalog.generatedOnly')}</option>
            <option value="imported">{t('sourceCatalog.importedOnly')}</option>
          </select>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700/50 bg-[#0d0f15]/70 px-3 py-2 text-[11px] leading-4 text-gray-400">
          <FolderOpen aria-hidden="true" size={13} className="shrink-0" />
          {activeProjectId
            ? tf('sourceCatalog.bytesNoteActive', { name: activeProjectName ?? activeProjectId })
            : t('sourceCatalog.bytesNoteNoActive')}
        </div>

        {outcome.results.length === 0 ? (
          <p className="mt-3 rounded-lg border border-gray-700/60 bg-[#0d1118] px-3 py-4 text-center text-xs text-gray-400" data-source-catalog-empty="true">
            {records.length === 0 ? t('sourceCatalog.emptyNoRecords') : t('sourceCatalog.emptyNoMatches')}
          </p>
        ) : (
          <ul className="mt-3 flex-1 overflow-y-auto pr-1" data-source-catalog-results="true">
            {outcome.results.map((result) => (
              <li
                className="mb-1.5 rounded-xl border border-gray-700/60 bg-[#0d1118] px-3 py-2"
                data-source-catalog-result={`${result.record.projectId}:${result.entry.itemId}`}
                key={`${result.record.projectId}:${result.entry.itemId}`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-gray-100">{result.entry.label}</span>
                  <span className="shrink-0 rounded border border-gray-700/70 bg-[#10151f] px-1.5 py-0.5 text-[10px] font-semibold text-gray-400">
                    {result.entry.kind}
                  </span>
                  {result.entry.isGenerated ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan-300/30 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200">
                      <Sparkles aria-hidden="true" size={10} />
                      {t('sourceCatalog.generatedBadge')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[11px] leading-4 text-gray-400">
                  {result.record.projectId === activeProjectId
                    ? tf('sourceCatalog.currentProjectName', { name: result.record.projectName })
                    : result.record.projectName}
                  {' · '}
                  {tf('sourceCatalog.savedAt', { date: new Date(result.record.lastSavedAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : undefined) })}
                </div>
                {result.alsoInProjectIds.length > 0 ? (
                  <div className="mt-1 text-[11px] leading-4 text-emerald-300/80" data-source-catalog-lineage="true">
                    {tf('sourceCatalog.alsoIn', {
                      projects: result.alsoInProjectIds
                        .map((projectId) => projectNameByFilterId.get(projectId) ?? projectId)
                        .join(', '),
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {outcome.truncated ? (
          <p className="mt-2 text-[11px] text-amber-300/80" data-source-catalog-truncated="true">
            {tf('sourceCatalog.truncated', { shown: outcome.results.length, total: outcome.totalMatches })}
          </p>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-700/60 pt-3">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/60 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:border-amber-300/50 hover:text-amber-100"
            data-source-catalog-forget="true"
            disabled={!projectFilter}
            onClick={() => {
              if (projectFilter) {
                forgetProject(projectFilter);
                setProjectFilter('');
              }
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" size={12} />
            {projectFilter
              ? tf('sourceCatalog.forgetProject', { name: projectNameByFilterId.get(projectFilter) ?? projectFilter })
              : t('sourceCatalog.forgetProjectNone')}
          </button>
          <button
            className="rounded-lg border border-gray-700/60 px-2.5 py-1.5 text-[11px] font-semibold text-gray-400 transition-colors hover:border-red-300/40 hover:text-red-200"
            data-source-catalog-clear="true"
            disabled={records.length === 0}
            onClick={() => clearCatalogue()}
            type="button"
          >
            {t('sourceCatalog.clear')}
          </button>
        </div>
      </div>
    </div>
  );
}
