export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  ariaLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  ariaLabel?: string;
}) {
  const handleInput = (value: string) => {
    onChange(parseFloat(value));
  };

  return (
    <div>
      <label className="mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="text-cyan-100/40">{format(value)}</span>
      </label>
      <input
        aria-label={ariaLabel}
        // touch-pan-y: let a vertical swipe scroll the panel even when it starts on the slider
        // (Android WebView otherwise lets the range input claim the gesture, freezing the scroll).
        // Horizontal drags still adjust the value.
        className="w-full cursor-pointer accent-cyan-400 touch-pan-y"
        max={max}
        min={min}
        onChange={(e) => handleInput(e.currentTarget.value)}
        onInput={(e) => handleInput(e.currentTarget.value)}
        step={step}
        type="range"
        value={value}
      />
    </div>
  );
}

export function Field({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 items-center gap-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1">
      <span className="text-cyan-100/40">{label}</span>
      <span className="flex-1 text-right text-cyan-100/80">{value}</span>
    </div>
  );
}
