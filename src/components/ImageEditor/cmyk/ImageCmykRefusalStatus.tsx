import { useEffect, useState } from 'react';

/** Always-mounted disclosure for edits that would discard native CMYKA authority. */
export function ImageCmykRefusalStatus() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRefusal = (event: Event) => {
      const detail = (event as CustomEvent<{ disclosure?: string }>).detail;
      setMessage(detail?.disclosure ?? 'This tool is refused for native CMYK; no ink authority changed.');
    };
    window.addEventListener('sloom-cmyk-tool-refused', onRefusal);
    return () => window.removeEventListener('sloom-cmyk-tool-refused', onRefusal);
  }, []);

  if (!message) return null;

  return (
    <div
      aria-live="assertive"
      className="mt-3 rounded border border-amber-300/25 bg-amber-300/10 px-2 py-1.5 text-[11px] leading-4 text-amber-100/80"
      data-image-cmyk-refusal-status
      role="status"
    >
      {message}
    </div>
  );
}
