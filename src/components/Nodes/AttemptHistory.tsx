import { useEffect, useState } from 'react';
import { Archive, Music, Type } from 'lucide-react';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { fetchRemoteHostSourceAssetDataUrl, isServedLanSession } from '../../lib/remoteHostClient';
import type { NodeResultAttempt } from '../../types/flow';
import { resultValueAsMediaUrl } from '../../lib/flowResultValues';

interface AttemptHistoryProps {
  attempts?: NodeResultAttempt[];
  selectedAttemptId?: string;
  onSelectAttempt?: (attemptId: string) => void;
  onAssignVariable?: (attemptId: string, variableName: string) => void;
}

export function AttemptHistory({
  attempts = [],
  selectedAttemptId,
  onSelectAttempt,
  onAssignVariable,
}: AttemptHistoryProps) {
  // Each attempt's `result` is the phone-local source-bin asset URL — unfetchable from a served browser.
  // On a served session, resolve image/video thumbnails out-of-band by the attempt's `sourceBinItemId`
  // (the universal `/source-asset/:id` path) and render those instead of broken thumbnails.
  const [resolvedThumbs, setResolvedThumbs] = useState<Record<string, string>>({});

  const servedSession = isServedLanSession();
  const resolvableKey = servedSession
    ? attempts
        .filter((attempt) => attempt.resultType === 'image' || attempt.resultType === 'video')
        .map((attempt) => `${attempt.id}:${attempt.sourceBinItemId ?? ''}`)
        .join('|')
    : '';

  useEffect(() => {
    if (!servedSession) {
      setResolvedThumbs((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    let cancelled = false;
    const targets = attempts.filter(
      (attempt) =>
        (attempt.resultType === 'image' || attempt.resultType === 'video') &&
        typeof attempt.sourceBinItemId === 'string' &&
        attempt.sourceBinItemId.length > 0,
    );

    void Promise.all(
      targets.map(async (attempt) => {
        const url = await fetchRemoteHostSourceAssetDataUrl(attempt.sourceBinItemId as string);
        return url ? ([attempt.id, url] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setResolvedThumbs(next);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedSession, resolvableKey]);

  if (attempts.length === 0 || (!onSelectAttempt && !onAssignVariable)) {
    return null;
  }

  const useGridLayout = attempts.length > 6;
  const selectedAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId) ?? attempts[attempts.length - 1];

  return (
    <div className="space-y-1">
      {attempts.length > 1 && onSelectAttempt ? (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Runs</div>
          <div className={useGridLayout ? 'grid grid-cols-4 gap-1.5' : 'flex gap-1.5 overflow-x-auto pb-1'}>
            {attempts.map((attempt, index) => {
              const isActive = attempt.id === selectedAttemptId;

              return (
                <button
                  key={attempt.id}
                  className={withFlowNodeInteractionClasses(`overflow-hidden rounded-lg border transition-colors ${
                    isActive
                      ? 'border-blue-400 bg-blue-500/10'
                      : 'border-gray-700/60 bg-[#111217]/35 hover:border-gray-500'
                  } ${useGridLayout ? 'aspect-square min-w-0' : 'aspect-square w-12 shrink-0'}`)}
                  onClick={() => onSelectAttempt(attempt.id)}
                  title={`Run ${index + 1} · ${new Date(attempt.createdAt).toLocaleString()}`}
                  type="button"
                >
                  {renderAttemptPreview(attempt, index, resolvedThumbs[attempt.id])}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {selectedAttempt && onAssignVariable ? (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Variable</span>
          <input
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 outline-none focus:border-blue-300')}
            onChange={(event) => onAssignVariable(selectedAttempt.id, event.target.value)}
            placeholder="variable_name"
            value={selectedAttempt.variableName ?? ''}
          />
        </label>
      ) : null}
    </div>
  );
}

function renderAttemptPreview(attempt: NodeResultAttempt, index: number, resolvedThumb?: string) {
  const previewSrc = resolvedThumb ?? resultValueAsMediaUrl(attempt.result);

  if (attempt.resultType === 'image' && previewSrc) {
    return <img alt={`Run ${index + 1}`} className="h-full w-full object-cover" src={previewSrc} />;
  }

  if (attempt.resultType === 'video' && previewSrc) {
    return (
      <video
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        src={previewSrc}
      />
    );
  }

  const Icon = attempt.resultType === 'audio' ? Music : attempt.resultType === 'package' ? Archive : Type;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-200">
      {attempt.resultType === 'audio' || attempt.resultType === 'package' ? <Icon size={14} /> : <Icon size={13} />}
      <span className="text-[10px] font-semibold">R{index + 1}</span>
    </div>
  );
}
