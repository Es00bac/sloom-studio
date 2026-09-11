import { Image as ImageIcon } from 'lucide-react';

export function ImageGenerationProgressBackdrop() {
  return (
    <div className="relative flex min-h-[9rem] w-full overflow-hidden rounded-lg bg-[#070a12]">
      <div className="absolute inset-[-20%] animate-pulse bg-[radial-gradient(circle_at_18%_22%,rgba(96,165,250,0.55),transparent_30%),radial-gradient(circle_at_78%_28%,rgba(45,212,191,0.42),transparent_28%),radial-gradient(circle_at_48%_78%,rgba(251,191,36,0.32),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.96))] blur-2xl" />
      <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/35" />
      <div className="relative z-10 flex w-full flex-col items-center justify-center px-4 py-5 text-center">
        <div className="mb-2 rounded-full border border-blue-200/25 bg-blue-100/10 p-3 text-blue-100 shadow-[0_0_28px_rgba(96,165,250,0.2)]">
          <ImageIcon size={22} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-50/90">
          Rendering Image
        </div>
        <div className="mt-1 max-w-[13rem] text-[11px] leading-4 text-blue-50/70">
          Waiting for the provider's final frame.
        </div>
      </div>
    </div>
  );
}
