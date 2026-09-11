import { useMemo, type ReactNode } from 'react';
import { BarChart3, DollarSign } from 'lucide-react';
import {
  estimateExecutionPlan,
  formatRollupSummary,
  formatUsageSummary,
} from '../../lib/costEstimation';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { UsageTelemetry } from '../../types/flow';

interface ExecutionTelemetryPanelProps {
  nodeId: string;
  usage?: UsageTelemetry;
}

export function ExecutionTelemetryPanel({ nodeId, usage }: ExecutionTelemetryPanelProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const defaultModels = useSettingsStore((state) => state.defaultModels);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const settings = useMemo(
    () => ({
      apiKeys,
      defaultModels,
      providerSettings,
    }),
    [apiKeys, defaultModels, providerSettings],
  );

  const estimate = useMemo(
    () => estimateExecutionPlan(nodeId, nodes, edges, settings),
    [nodeId, nodes, edges, settings],
  );

  const estimateSummary = estimate.telemetries.length > 0
    ? formatRollupSummary(estimate.rollup, 'Before run')
    : undefined;
  const actualSummary = formatUsageSummary(usage, 'Last run');

  if (!estimateSummary && !actualSummary) {
    return null;
  }

  return (
    <div className="space-y-2">
      {estimateSummary ? (
        <TelemetryCard
          accentClassName={estimate.rollup.unknownCostCount > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-50' : 'border-blue-500/25 bg-blue-500/10 text-blue-50'}
          icon={<DollarSign size={12} />}
          summary={estimateSummary}
          title="Run estimate"
        />
      ) : null}

      {actualSummary ? (
        <TelemetryCard
          accentClassName="border-emerald-500/25 bg-emerald-500/10 text-emerald-50"
          icon={<BarChart3 size={12} />}
          summary={actualSummary}
          title="Recorded usage"
        />
      ) : null}
    </div>
  );
}

interface TelemetryCardProps {
  accentClassName: string;
  icon: ReactNode;
  summary: string;
  title: string;
}

function TelemetryCard({ accentClassName, icon, summary, title }: TelemetryCardProps) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${accentClassName}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">
        {icon}
        {title}
      </div>
      <div className="text-[11px] leading-relaxed">{summary}</div>
    </div>
  );
}
