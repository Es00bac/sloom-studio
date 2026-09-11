import { useMemo, useState, type ReactNode } from 'react';
import { Activity, RefreshCw, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import {
  collectActualUsageRollup,
  estimateCanvasRunCosts,
  formatUsd,
  formatRollupSummary,
} from '../../lib/costEstimation';
import { useFlowStore } from '../../store/flowStore';
import { useProjectUsageStore } from '../../store/projectUsageStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { ProjectUsageLedgerBucket, ProjectUsageLedgerSummary } from '../../lib/projectUsageLedger';
import type { ProviderBalance } from '../../lib/providerBalance';
import type { WorkspaceView } from '../../types/flow';
import { useI18n } from '../../lib/useI18n';
import type { UseI18n } from '../../lib/useI18n';

interface UsageBarProps {
  workspaceView?: WorkspaceView;
  placement?: UsageBarPlacement;
}

type UsageBarPlacement = 'overlay' | 'topbar' | 'mobile-drawer';

const flowUsageBarPositionClassName = 'pointer-events-none absolute left-1/2 top-20 z-[60] -translate-x-1/2';
const topbarUsageBarPositionClassName = 'pointer-events-auto relative min-w-0 shrink-0';
const mobileDrawerUsageBarPositionClassName = 'relative min-w-0';

export function getUsageBarPositionClassName(
  workspaceView: WorkspaceView = 'flow',
  placement?: UsageBarPlacement,
): string {
  const resolvedPlacement = placement ?? 'topbar';
  if (resolvedPlacement === 'overlay') {
    return flowUsageBarPositionClassName;
  }

  if (resolvedPlacement === 'mobile-drawer') {
    return mobileDrawerUsageBarPositionClassName;
  }

  void workspaceView;
  return topbarUsageBarPositionClassName;
}

export function UsageBar({ placement, workspaceView = 'flow' }: UsageBarProps) {
  const { t, tf } = useI18n();
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const defaultModels = useSettingsStore((state) => state.defaultModels);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const projectSummary = useProjectUsageStore((state) => state.summary);
  const balances = useProjectUsageStore((state) => state.balances);
  const balancesLoading = useProjectUsageStore((state) => state.balancesLoading);
  const refreshBalances = useProjectUsageStore((state) => state.refreshBalances);

  const [isMinimized, setIsMinimized] = useState(() => {
    return localStorage.getItem('signal-loom-usage-bar-minimized') === 'true';
  });
  const [detailsOpen, setDetailsOpen] = useState(false);

  const settings = useMemo(
    () => ({
      apiKeys,
      defaultModels,
      providerSettings,
    }),
    [apiKeys, defaultModels, providerSettings],
  );

  const canvasEstimate = useMemo(
    () => estimateCanvasRunCosts(nodes, edges, settings),
    [nodes, edges, settings],
  );
  const actualUsage = useMemo(() => collectActualUsageRollup(nodes), [nodes]);
  const projectSpendSummary = formatProjectSpendSummary(projectSummary, tf);
  const resolvedPlacement = placement ?? 'topbar';
  const positionClassName = getUsageBarPositionClassName(workspaceView, resolvedPlacement);

  const toggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      localStorage.setItem('signal-loom-usage-bar-minimized', String(next));
      return next;
    });
  };

  if (resolvedPlacement === 'topbar' || resolvedPlacement === 'mobile-drawer') {
    const compact = resolvedPlacement === 'topbar';
    return (
      <div
        className={positionClassName}
        data-signal-loom-usage-bar="true"
        data-signal-loom-usage-bar-placement={resolvedPlacement}
        data-signal-loom-usage-bar-workspace={workspaceView}
      >
        <button
          aria-expanded={detailsOpen}
          aria-label={t('usage.toggle')}
          className={`pointer-events-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-cyan-300/15 bg-[#101a29]/80 px-2.5 text-[11px] font-semibold text-cyan-100/75 transition-colors hover:border-cyan-300/40 hover:text-white ${
            compact ? 'max-w-44' : 'w-full'
          }`}
          onClick={() => setDetailsOpen((open) => !open)}
          title={t('usage.tooltip')}
          type="button"
        >
          <Wallet size={13} className="shrink-0 text-cyan-300" />
          <span className="min-w-0 truncate">{compact ? formatUsd(projectSummary.totalKnownCostUsd) : projectSpendSummary}</span>
          <ChevronDown className={`shrink-0 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} size={12} />
        </button>
        {detailsOpen ? (
          <ProjectSpendPopover
            balances={balances}
            balancesLoading={balancesLoading}
            onRefreshBalances={() => void refreshBalances(apiKeys)}
            placement={resolvedPlacement}
            summary={projectSummary}
          />
        ) : null}
      </div>
    );
  }

  if (isMinimized) {
    return (
      <div
        className={positionClassName}
        data-signal-loom-usage-bar="true"
        data-signal-loom-usage-bar-placement={resolvedPlacement}
        data-signal-loom-usage-bar-workspace={workspaceView}
      >
        <button
          aria-expanded={false}
          aria-label={t('usage.show')}
          onClick={toggleMinimize}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-500/30 bg-[#171922]/95 px-3 py-1.5 text-[11px] font-medium text-cyan-100/90 shadow-2xl hover:border-cyan-400/60 hover:bg-[#1c1f2c]/95 transition-all duration-200"
          title={t('usage.showFull')}
        >
          <span className="flex items-center gap-1">
            <Wallet size={12} className="text-cyan-400" />
            <span>{t('usage.projectLabel')}</span>
            <span className="font-mono text-cyan-300 font-bold">{formatUsd(projectSummary.totalKnownCostUsd)}</span>
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-[10px] text-gray-400">{t('usage.expand')}</span>
          <ChevronDown size={12} className="text-cyan-400" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={positionClassName}
      data-signal-loom-usage-bar="true"
      data-signal-loom-usage-bar-placement={resolvedPlacement}
      data-signal-loom-usage-bar-workspace={workspaceView}
    >
      <div className="pointer-events-none flex min-w-[420px] max-w-[86vw] items-center gap-2 rounded-2xl border border-gray-700/70 bg-[#171922]/90 px-3 py-2 shadow-2xl backdrop-blur-md">
        <UsagePill
          icon={<Wallet size={14} />}
          summary={formatRollupSummary(canvasEstimate, t('usage.canvasEstimate'))}
          toneClassName={canvasEstimate.unknownCostCount > 0 ? 'border-amber-500/25 bg-amber-500/10 text-amber-50' : 'border-blue-500/25 bg-blue-500/10 text-blue-50'}
        />
        <UsagePill
          icon={<Activity size={14} />}
          summary={formatRollupSummary(actualUsage, t('usage.actualSession'))}
          toneClassName="border-emerald-500/25 bg-emerald-500/10 text-emerald-50"
        />
        <UsagePill
          ariaExpanded={detailsOpen}
          ariaLabel={t('usage.toggleDetails')}
          button
          icon={<Wallet size={14} />}
          onClick={() => setDetailsOpen((open) => !open)}
          summary={projectSpendSummary}
          toneClassName={projectSummary.unknownCostEntryCount > 0 ? 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-50' : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-50'}
        />
        <button
          aria-expanded={true}
          aria-label={t('usage.minimize')}
          onClick={toggleMinimize}
          className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-700/60 bg-gray-800/20 text-gray-400 hover:border-gray-500 hover:bg-gray-700/30 hover:text-gray-200 transition-all"
          title={t('usage.minimize')}
        >
          <ChevronUp size={14} />
        </button>
      </div>
      {detailsOpen ? (
        <ProjectSpendPopover
          balances={balances}
          balancesLoading={balancesLoading}
          onRefreshBalances={() => void refreshBalances(apiKeys)}
          placement={resolvedPlacement}
          summary={projectSummary}
        />
      ) : null}
    </div>
  );
}

interface UsagePillProps {
  ariaExpanded?: boolean;
  ariaLabel?: string;
  button?: boolean;
  icon: ReactNode;
  onClick?: () => void;
  summary: string;
  toneClassName: string;
}

function UsagePill({ ariaExpanded, ariaLabel, button = false, icon, onClick, summary, toneClassName }: UsagePillProps) {
  const className = `min-w-0 flex-1 rounded-xl border px-3 py-2 text-left ${toneClassName}`;
  const content = (
      <div className="flex items-center gap-2 text-[11px] leading-relaxed">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{summary}</span>
      </div>
  );
  if (button) {
    return (
      <button
        aria-expanded={ariaExpanded}
        aria-label={ariaLabel}
        className={`pointer-events-auto ${className} transition hover:border-cyan-200/50`}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <div className={`pointer-events-none ${className}`}>
      {content}
    </div>
  );
}

function ProjectSpendPopover({
  balances,
  balancesLoading,
  onRefreshBalances,
  placement = 'overlay',
  summary,
}: {
  balances: ProviderBalance[];
  balancesLoading: boolean;
  onRefreshBalances: () => void;
  placement?: UsageBarPlacement;
  summary: ProjectUsageLedgerSummary;
}) {
  const { t, tf } = useI18n();
  const placementClassName = placement === 'topbar'
    ? 'absolute right-0 top-full z-[95] mt-2 w-[min(860px,86vw)]'
    : placement === 'mobile-drawer'
      ? 'mt-2 w-full'
      : 'mt-2 w-[min(860px,86vw)]';

  return (
    <div
      className={`pointer-events-auto rounded-xl border border-cyan-300/15 bg-[#111620]/95 p-3 text-xs text-cyan-50 shadow-2xl shadow-black/50 backdrop-blur-md ${placementClassName}`}
      data-usage-spend-popover="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/55">{t('usage.ledger')}</div>
          <div className="mt-1 text-sm font-semibold text-white">
            {tf('usage.knownAcross', { known: formatUsd(summary.totalKnownCostUsd), count: summary.entryCount })}
          </div>
          {summary.unknownCostEntryCount > 0 ? (
            <div className="mt-1 text-[11px] text-amber-100/80">
              {tf('usage.unknownPricing', { count: summary.unknownCostEntryCount })}
            </div>
          ) : null}
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:border-cyan-200/50 disabled:cursor-wait disabled:opacity-60"
          disabled={balancesLoading}
          onClick={onRefreshBalances}
          type="button"
        >
          <RefreshCw className={balancesLoading ? 'animate-spin' : ''} size={12} />
          {t('usage.balances')}
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SpendBreakdown title={t('settings.pricing.provider')} rows={summary.byProvider} />
        <SpendBreakdown title={t('settings.pricing.model')} rows={summary.byModel} />
        <SpendBreakdown title={t('settings.pricing.operation')} rows={summary.byOperation} />
        <SpendBreakdown title={t('usage.workspace')} rows={summary.byWorkspace} />
      </div>
      <div className="mt-3 rounded-lg border border-gray-700/60 bg-black/20 p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{t('usage.providerBalances')}</div>
        {balances.length > 0 ? (
          <div className="grid gap-1.5 md:grid-cols-2">
            {balances.map((balance) => <BalanceRow balance={balance} key={balance.provider} />)}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400">{t('usage.balancesHint')}</div>
        )}
      </div>
    </div>
  );
}

function SpendBreakdown({ rows, title }: { rows: ProjectUsageLedgerBucket[]; title: string }) {
  const { t } = useI18n();
  const visibleRows = rows.slice(0, 5);
  return (
    <div className="rounded-lg border border-gray-700/60 bg-black/20 p-2">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{title}</div>
      {visibleRows.length > 0 ? (
        <div className="space-y-1">
          {visibleRows.map((row) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" key={row.key}>
              <span className="truncate text-gray-200">{row.key}</span>
              <span className="font-mono text-cyan-100">{formatUsd(row.totalKnownCostUsd)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-gray-500">{t('usage.noUsage')}</div>
      )}
    </div>
  );
}

function BalanceRow({ balance }: { balance: ProviderBalance }) {
  const value = balance.status === 'available'
    ? `${formatUsd(balance.estimatedUsd)} / ${balance.credits?.toFixed(2)} credits`
    : balance.status;
  return (
    <div className="rounded-md border border-gray-700/50 bg-[#11131a] px-2 py-1.5">
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-gray-200">{balance.label}</span>
        <span className="font-mono text-cyan-100">{value}</span>
      </div>
      {balance.message ? <div className="mt-1 text-[10px] leading-snug text-gray-500">{balance.message}</div> : null}
    </div>
  );
}

function formatProjectSpendSummary(summary: ProjectUsageLedgerSummary, tf: UseI18n['tf']): string {
  const unknown = summary.unknownCostEntryCount > 0 ? tf('usage.unknownSuffix', { count: summary.unknownCostEntryCount }) : '';
  return `${tf('usage.projectTotal', { total: formatUsd(summary.totalKnownCostUsd) })}${unknown}`;
}
