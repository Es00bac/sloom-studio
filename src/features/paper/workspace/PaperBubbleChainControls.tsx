import type { PaperDocument, PaperFrame } from '../../../types/paper';
import { getPaperBubbleChainFrames } from '../../../lib/paperBubbleChains';
import { paperFrameLayerIsLocked } from '../../../lib/paperLayers';
import { useI18n } from '../../../lib/useI18n';

export interface PaperBubbleChainControlsProps {
  document: Pick<PaperDocument, 'layers'>;
  frame: PaperFrame;
  pageFrames: PaperFrame[];
  onChainWith: (targetFrameId: string) => void;
  onMove: (direction: 'earlier' | 'later') => void;
  onUnchain: () => void;
}

function isBubble(frame: PaperFrame): boolean {
  return frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
}

export function PaperBubbleChainControls({
  document,
  frame,
  pageFrames,
  onChainWith,
  onMove,
  onUnchain,
}: PaperBubbleChainControlsProps) {
  const { t, tf } = useI18n();
  const isEditable = (candidate: PaperFrame) => (
    !candidate.inherited && !candidate.locked && !paperFrameLayerIsLocked(document, candidate)
  );
  const candidates = pageFrames.filter((candidate) =>
    candidate.id !== frame.id
      && isBubble(candidate)
      && isEditable(candidate)
      && (!candidate.bubbleChainId
        || getPaperBubbleChainFrames(pageFrames, candidate.bubbleChainId).every(isEditable))
  );
  const members = frame.bubbleChainId
    ? getPaperBubbleChainFrames(pageFrames, frame.bubbleChainId)
    : [];
  const selectedIndex = members.findIndex((candidate) => candidate.id === frame.id);
  const unavailable = !isEditable(frame) || members.some((member) => !isEditable(member));

  return (
    <div
      className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2"
      data-paper-bubble-chain-controls="true"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">
        {t('paper.ctx.bubbleChain')}
      </div>
      <div className="mb-2 text-[11px] leading-4 text-cyan-100/45">
        {t('paper.insp.chainPickerHelp')}
      </div>
      <label className="block text-[11px] font-semibold text-cyan-100/55">
        {t('paper.insp.chainWith')}
        <select
          aria-label={t('paper.insp.chainWith')}
          className="paper-input mt-1"
          disabled={unavailable || candidates.length === 0}
          onChange={(event) => {
            if (event.target.value) onChainWith(event.target.value);
          }}
          value=""
        >
          <option value="">{t('paper.insp.chainWithPlaceholder')}</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label || candidate.id}
              {candidate.bubbleChainId ? ` · ${t('paper.insp.chainLinked')}` : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-2 rounded-md border border-cyan-300/10 bg-[#101a29]/60 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">
            {t('paper.insp.chainMembers')}
          </span>
          <span className="text-[10px] text-cyan-100/45">
            {members.length > 0
              ? tf('paper.insp.chainMemberCount', { count: members.length })
              : t('paper.insp.chainNotLinked')}
          </span>
        </div>
        {members.length > 0 ? (
          <ol className="mt-1.5 space-y-1" data-paper-bubble-chain-members="true">
            {members.map((member, index) => (
              <li
                className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-[11px] ${
                  member.id === frame.id
                    ? 'bg-cyan-400/10 text-cyan-50'
                    : 'text-cyan-100/55'
                }`}
                key={member.id}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 text-[9px]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{member.label || member.id}</span>
                {member.id === frame.id ? (
                  <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-cyan-200/55">
                    {t('paper.insp.chainSelected')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={unavailable || selectedIndex <= 0}
          onClick={() => onMove('earlier')}
          type="button"
        >
          {t('paper.insp.chainMoveEarlier')}
        </button>
        <button
          className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={unavailable || selectedIndex < 0 || selectedIndex >= members.length - 1}
          onClick={() => onMove('later')}
          type="button"
        >
          {t('paper.insp.chainMoveLater')}
        </button>
      </div>
      <button
        className="mt-1.5 w-full rounded-md border border-rose-300/15 bg-rose-400/5 px-2 py-1 text-left text-[11px] text-rose-100/65 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={unavailable || !frame.bubbleChainId}
        onClick={onUnchain}
        type="button"
      >
        {t('paper.insp.clearBubbleChain')}
      </button>
    </div>
  );
}
