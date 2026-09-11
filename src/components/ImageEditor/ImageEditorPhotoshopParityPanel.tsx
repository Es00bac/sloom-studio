import { countImageParityStatuses, getHighPriorityImageParityItems, getImageParityChecklistStatus } from './ImagePhotoshopParity';

export function PhotoshopParityPanel() {
  const highPriority = getHighPriorityImageParityItems();
  const statuses = countImageParityStatuses();

  return (
    <div className="mt-3 space-y-2 rounded border border-amber-300/10 bg-[#111018] p-2 text-xs text-cyan-100/60">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold uppercase tracking-[0.16em] text-amber-100/50">
          Layering Checklist
        </div>
        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100/65">
          {statuses.done} done / {statuses.partial} partial / {statuses.remaining} gaps
        </span>
      </div>
      <div className="space-y-1.5">
        {highPriority.map((item) => {
          const status = getImageParityChecklistStatus(item);

          return (
          <div className="rounded border border-cyan-300/10 bg-[#1a1b23] p-2" key={item.id}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-cyan-100/75">{item.area}</span>
              <span className={`text-[10px] uppercase tracking-wide ${parityStatusClass(status)}`}>
                {status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] leading-snug text-cyan-100/45">
              <span>PS: {item.photoshop}</span>
              <span>SL: {item.signalLoom}</span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-cyan-100/35">{item.workflowReason}</p>
          </div>
        );})}
      </div>
    </div>
  );
}

function parityStatusClass(status: 'done' | 'partial' | 'remaining'): string {
  switch (status) {
    case 'done':
      return 'text-emerald-100/60';
    case 'partial':
      return 'text-amber-100/60';
    case 'remaining':
      return 'text-red-100/60';
  }
}
