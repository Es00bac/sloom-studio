import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';

const VIDEO_DURATION_STEPS = [4, 6, 8] as const;

interface VideoDurationSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  steps?: readonly number[];
}

export function VideoDurationSlider({
  value,
  onChange,
  disabled = false,
  className,
  steps = VIDEO_DURATION_STEPS,
}: VideoDurationSliderProps) {
  const currentIndex = steps.indexOf(value);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : Math.max(0, steps.indexOf(6));

  return (
    <div className={className}>
      <input
        className={withFlowNodeInteractionClasses('h-2 w-full cursor-pointer accent-blue-500 disabled:cursor-not-allowed disabled:opacity-60')}
        disabled={disabled}
        max={String(steps.length - 1)}
        min="0"
        onChange={(event) => onChange(steps[Number(event.target.value)] ?? steps[0] ?? 6)}
        step="1"
        type="range"
        value={String(resolvedIndex)}
      />

      <div className="mt-1 flex flex-wrap gap-1">
        {steps.map((step) => {
          const active = step === steps[resolvedIndex];

          return (
            <button
              key={step}
              className={withFlowNodeInteractionClasses(`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                active
                  ? 'bg-blue-500 text-white'
                  : 'bg-[#111217]/40 text-gray-400 hover:bg-[#111217]/70 hover:text-gray-200'
              } disabled:cursor-not-allowed disabled:opacity-60`)}
              disabled={disabled}
              onClick={() => onChange(step)}
              type="button"
            >
              {step}s
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { VIDEO_DURATION_STEPS };
