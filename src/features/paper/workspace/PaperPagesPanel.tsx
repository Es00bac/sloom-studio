import { Copy, FilePlus2, Maximize2 } from 'lucide-react';
import type { PaperDocument, PaperFrame, PaperPage } from '../../../types/paper';
import { resolvePaperPageFramesForCanvas } from '../../../lib/paperDocument';
import { useI18n } from '../../../lib/useI18n';

export interface PaperPagesPanelProps {
  document: PaperDocument;
  selectedPageId: string;
  onAddPage: () => void;
  onDuplicatePage: () => void;
  onFitPage: () => void;
  onFitSpread: () => void;
  onSelectPage: (pageId: string) => void;
}

export function PaperPagesPanel({
  document,
  selectedPageId,
  onAddPage,
  onDuplicatePage,
  onFitPage,
  onFitSpread,
  onSelectPage,
}: PaperPagesPanelProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full min-h-0 flex-col text-xs text-cyan-100/75" data-paper-pages-panel="true">
      <div className="grid grid-cols-2 gap-1.5 border-b border-cyan-300/10 p-2">
        <PanelAction icon={<Maximize2 size={12} />} label={t('paper.pages.fitPage')} onClick={onFitPage} />
        <PanelAction icon={<Maximize2 size={12} />} label={t('paper.pages.fitSpread')} onClick={onFitSpread} />
        <PanelAction icon={<FilePlus2 size={12} />} label={t('paper.pages.add')} onClick={onAddPage} />
        <PanelAction icon={<Copy size={12} />} label={t('paper.pages.duplicate')} onClick={onDuplicatePage} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-2">
          {document.pages.map((page) => (
            <PaperPageThumbnail
              document={document}
              key={page.id}
              onSelect={() => onSelectPage(page.id)}
              page={page}
              selected={page.id === selectedPageId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PaperPageThumbnail({
  document,
  page,
  selected,
  onSelect,
}: {
  document: PaperDocument;
  page: PaperPage;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, tf } = useI18n();
  const frames = resolvePaperPageFramesForCanvas(document, page);
  const aspectRatio = document.page.widthMm / Math.max(1, document.page.heightMm);
  return (
    <button
      aria-current={selected ? 'page' : undefined}
      aria-label={tf('paper.pages.pageLabel', { number: page.pageNumber })}
      className={`group rounded-md border p-1.5 text-left transition ${
        selected
          ? 'border-cyan-300/65 bg-cyan-400/10 text-cyan-50'
          : 'border-cyan-300/10 bg-[#101a29]/55 text-cyan-100/55 hover:border-cyan-300/35'
      }`}
      data-paper-page-thumbnail={page.id}
      onClick={onSelect}
      type="button"
    >
      <div
        className="relative w-full overflow-hidden border border-slate-400/45 bg-white shadow-sm"
        style={{ aspectRatio }}
      >
        {frames.map((frame) => <ThumbnailFrame document={document} frame={frame} key={frame.id} />)}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
        <span>{page.pageNumber}</span>
        <span className="truncate text-cyan-100/35">{page.parentPageId ? t('paper.pages.parent') : ''}</span>
      </div>
    </button>
  );
}

function ThumbnailFrame({ document, frame }: { document: PaperDocument; frame: PaperFrame }) {
  const isImage = frame.kind === 'image' || frame.kind === 'panel';
  const isText = frame.kind === 'text' || frame.kind === 'caption';
  return (
    <span
      className={`absolute overflow-hidden ${isImage ? 'bg-slate-400/75' : isText ? 'bg-slate-700/65' : ''}`}
      style={{
        background: isImage || isText ? undefined : frame.fillColor,
        border: frame.strokeWidthMm > 0 ? '1px solid rgba(15,23,42,.65)' : undefined,
        borderRadius: frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' ? '999px' : undefined,
        height: `${(frame.heightMm / document.page.heightMm) * 100}%`,
        left: `${(frame.xMm / document.page.widthMm) * 100}%`,
        opacity: Math.max(0.2, frame.opacity),
        top: `${(frame.yMm / document.page.heightMm) * 100}%`,
        width: `${(frame.widthMm / document.page.widthMm) * 100}%`,
      }}
    />
  );
}

function PanelAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="inline-flex min-w-0 items-center justify-center gap-1 rounded border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1.5 text-[10px] font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
