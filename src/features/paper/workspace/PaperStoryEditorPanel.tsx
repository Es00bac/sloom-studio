import { useMemo, useState } from 'react';
import { BookOpenText, ExternalLink, Save } from 'lucide-react';
import type { PaperDocument } from '../../../types/paper';
import { createPaperCanvasMeasurer } from '../../../lib/paperCanvasMeasurer';
import { computePaperThreadSlices } from '../../../lib/paperThreadFlow';
import { useI18n } from '../../../lib/useI18n';
import {
  collectPaperStoryEditorEntries,
  paperStoryEntryForFrame,
} from './paperStoryEditorModel';

export interface PaperStoryEditorPanelProps {
  document: PaperDocument;
  selectedFrameId?: string | null;
  onApplyStory: (pageId: string, frameId: string, text: string, removeRichFormatting: boolean) => void;
  onRevealFrame: (pageId: string, frameId: string) => void;
}

const storyMeasure = createPaperCanvasMeasurer();

export function PaperStoryEditorPanel({
  document,
  selectedFrameId,
  onApplyStory,
  onRevealFrame,
}: PaperStoryEditorPanelProps) {
  const { t } = useI18n();
  const entries = useMemo(() => collectPaperStoryEditorEntries(document), [document]);
  const selectedEntry = paperStoryEntryForFrame(entries, selectedFrameId);
  const [manualSelection, setManualSelection] = useState<{
    selectedFrameId?: string | null;
    entryId: string;
  } | null>(null);
  const manualEntryId = manualSelection && manualSelection.selectedFrameId === selectedFrameId
    ? manualSelection.entryId
    : '';
  const entry = entries.find((candidate) => candidate.id === manualEntryId) ?? selectedEntry ?? entries[0];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = entry ? drafts[entry.id] ?? entry.text : '';

  const threadSlices = entry && entry.frames.length > 1
    ? computePaperThreadSlices(entry.frames.map((item) => item.frame), storyMeasure)
    : undefined;
  const tail = entry ? entry.frames[entry.frames.length - 1] : undefined;
  const overset = tail ? threadSlices?.get(tail.frame.id)?.isOverset ?? false : false;
  const changed = Boolean(entry && draft !== entry.text);
  const words = draft.trim() ? draft.trim().split(/\s+/u).length : 0;

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-cyan-100/45" data-paper-story-editor="true">
        {t('paper.story.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-xs text-cyan-100/75" data-paper-story-editor="true">
      <div className="border-b border-cyan-300/10 p-3">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">
          {t('paper.story.story')}
          <select
            className="mt-1.5 w-full rounded border border-cyan-300/20 bg-[#08111e] px-2 py-1.5 text-xs normal-case tracking-normal text-cyan-50 outline-none focus:border-cyan-300/45"
            onChange={(event) => setManualSelection({
              selectedFrameId,
              entryId: event.currentTarget.value,
            })}
            value={entry.id}
          >
            {entries.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} · p.{candidate.head.pageNumber}{candidate.frames.length > 1 ? ` · ${candidate.frames.length} frames` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-cyan-100/45">
          <span>{words} {t('paper.story.words')}</span>
          <span>·</span>
          <span>{draft.length} {t('paper.story.characters')}</span>
          <span>·</span>
          <span className={overset ? 'font-semibold text-amber-300' : 'text-emerald-300/75'}>
            {overset ? t('paper.story.overset') : t('paper.story.fits')}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <textarea
          aria-label={t('paper.story.editor')}
          className="h-full min-h-[12rem] w-full resize-none rounded-md border border-cyan-300/20 bg-[#07101c] p-3 font-serif text-sm leading-6 text-cyan-50 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!entry.editable}
          onChange={(event) => setDrafts((current) => ({
            ...current,
            [entry.id]: event.currentTarget.value,
          }))}
          spellCheck
          value={draft}
        />
      </div>

      <div className="border-t border-cyan-300/10 p-3">
        {entry.hasRichText && changed ? (
          <div className="mb-2 rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100/75">
            {t('paper.story.richWarning')}
          </div>
        ) : null}
        {!entry.editable ? (
          <div className="mb-2 text-[10px] text-amber-200/65">{t('paper.story.locked')}</div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <button
            className="inline-flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1.5 text-[10px] font-semibold text-cyan-100/70 hover:bg-cyan-400/10"
            onClick={() => onRevealFrame(entry.head.pageId, entry.head.frame.id)}
            type="button"
          >
            <ExternalLink size={11} /> {t('paper.story.reveal')}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded border border-cyan-300/35 bg-cyan-400/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!entry.editable || !changed}
            onClick={() => {
              onApplyStory(entry.head.pageId, entry.head.frame.id, draft, entry.hasRichText);
              setDrafts((current) => {
                const next = { ...current };
                delete next[entry.id];
                return next;
              });
            }}
            type="button"
          >
            {entry.hasRichText ? <BookOpenText size={11} /> : <Save size={11} />}
            {entry.hasRichText ? t('paper.story.applyPlain') : t('paper.story.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
