import { RotateCcw } from 'lucide-react';

interface MediaLoadingOverlayProps {
  title: string;
  detail: string;
}

export function MediaLoadingOverlay({ title, detail }: MediaLoadingOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#090a0f]/72 backdrop-blur-[2px]">
      <div className="rounded-xl border border-blue-500/30 bg-[#111217]/90 px-4 py-3 text-center shadow-xl">
        <div className="mb-2 flex items-center justify-center gap-2 text-sm font-semibold text-blue-100">
          <RotateCcw className="animate-spin" size={14} />
          {title}
        </div>
        <div className="text-[11px] text-blue-50/80">{detail}</div>
      </div>
    </div>
  );
}
