import type { ImageLayerFilter } from '../../../types/imageEditor';
import { LayerFiltersControls } from '../ImageEditorLayerStackEffectsControls';

export function ImageSmartFilterControls({
  disabled,
  filters,
  instanceCount,
  layerSize,
  onChange,
  hasDivergentInstances,
}: {
  disabled?: boolean;
  filters: ImageLayerFilter[];
  instanceCount: number;
  layerSize?: { width: number; height: number };
  onChange: (filters: ImageLayerFilter[]) => void;
  hasDivergentInstances: boolean;
}) {
  return (
    <section className="mt-2 rounded border border-cyan-300/20 bg-cyan-400/5 p-2" aria-label="Smart Filters">
      <div className="flex items-center justify-between text-xs text-cyan-100">
        <span>Smart Filters</span>
        <span className="text-[10px] text-cyan-100/50">
          {instanceCount === 1 ? '1 source instance' : `${instanceCount} shared instances`}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-cyan-100/55">
        Local retained filters are shared by this Smart Object source and compose identically in preview and flattened export.
      </p>
      {hasDivergentInstances ? (
        <p className="mt-1 text-[10px] text-amber-200/80" role="status">
          Legacy instance stacks differ. The next Smart Filter edit will synchronize this source in one undo step.
        </p>
      ) : null}
      <LayerFiltersControls
        disabled={disabled}
        filters={filters}
        layerSize={layerSize}
        onChange={onChange}
      />
      <p className="mt-1 text-[10px] text-cyan-100/40">
        Native Photoshop Smart Filters, adjustment-record filters, Camera Raw, and Liquify filters are unavailable.
      </p>
    </section>
  );
}
