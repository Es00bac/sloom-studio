import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers3,
  Lock,
  Plus,
  Printer,
  Unlock,
} from 'lucide-react';
import type { PaperDocument, PaperFrame, PaperLayer, PaperPage } from '../../../types/paper';
import type { PaperFrameContextActionId } from '../../../lib/paperUsabilityActions';
import { useI18n } from '../../../lib/useI18n';
import { buildPaperLayerPanelGroups } from './paperLayersPanelModel';

export interface PaperLayersPanelProps {
  document: PaperDocument;
  page: PaperPage | undefined;
  selectedFrameIds: string[];
  onAddLayer: () => void;
  onAssignSelectionToLayer: (layerId: string) => void;
  onMoveLayer: (layerId: string, direction: 'backward' | 'forward') => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onSelectFrame: (frameId: string, additive: boolean) => void;
  onSetLayerLocked: (layerId: string, locked: boolean) => void;
  onSetLayerPrintability: (layerId: string, printable: boolean) => void;
  onSetLayerVisibility: (layerId: string, visible: boolean) => void;
  onStackFrame: (frameId: string, action: Extract<PaperFrameContextActionId, 'bring-forward' | 'send-backward'>) => void;
  onToggleFrameLock: (frame: PaperFrame) => void;
}

/** Persistent document layers plus each current-page object, including hidden and non-printing objects. */
export function PaperLayersPanel({
  document,
  page,
  selectedFrameIds,
  onAddLayer,
  onAssignSelectionToLayer,
  onMoveLayer,
  onRenameLayer,
  onSelectFrame,
  onSetLayerLocked,
  onSetLayerPrintability,
  onSetLayerVisibility,
  onStackFrame,
  onToggleFrameLock,
}: PaperLayersPanelProps) {
  const { t } = useI18n();
  const layerGroups = buildPaperLayerPanelGroups(document, page);

  return (
    <div className="flex h-full min-h-0 flex-col text-xs text-cyan-100/75" data-paper-layers-panel="true">
      <div className="border-b border-cyan-300/10 px-3 py-2 text-[11px] leading-4 text-cyan-100/45">
        {t('paper.layers.help')}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-cyan-300/10 p-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">
          {t('paper.layers.backToFront')}
        </div>
        <button
          className="inline-flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1 text-[10px] font-semibold text-cyan-100/70 hover:bg-cyan-400/10"
          onClick={onAddLayer}
          type="button"
        >
          <Plus size={11} /> {t('paper.layers.add')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {layerGroups.map(({ layer, frames }) => {
            const documentLayerIndex = document.layers.findIndex((candidate) => candidate.id === layer.id);
            return (
              <section
                className="overflow-hidden rounded-md border border-cyan-300/15 bg-[#0d1725]/80"
                data-paper-layer-id={layer.id}
                key={layer.id}
              >
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 border-b border-cyan-300/10 px-1.5 py-1">
                  <Layers3 aria-hidden="true" className="text-cyan-200/45" size={13} />
                  <input
                    aria-label={`${t('paper.layers.rename')} ${layer.name}`}
                    className="min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-semibold text-cyan-50/85 outline-none focus:border-cyan-300/30 focus:bg-[#08111e]"
                    defaultValue={layer.name}
                    key={`${layer.id}:${layer.name}`}
                    onBlur={(event) => onRenameLayer(layer.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                  <div className="flex items-center gap-0.5">
                    <LayerButton
                      active={layer.visible}
                      label={layer.visible ? t('paper.layers.hide') : t('paper.layers.show')}
                      onClick={() => onSetLayerVisibility(layer.id, !layer.visible)}
                    >
                      {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </LayerButton>
                    <LayerButton
                      active={layer.printable}
                      label={layer.printable ? t('paper.layers.disablePrint') : t('paper.layers.enablePrint')}
                      onClick={() => onSetLayerPrintability(layer.id, !layer.printable)}
                    >
                      <Printer size={11} />
                    </LayerButton>
                    <LayerButton
                      active={layer.locked}
                      label={layer.locked ? t('paper.layers.unlockLayer') : t('paper.layers.lockLayer')}
                      onClick={() => onSetLayerLocked(layer.id, !layer.locked)}
                    >
                      {layer.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </LayerButton>
                    <LayerButton
                      disabled={documentLayerIndex >= document.layers.length - 1}
                      label={t('paper.layers.layerForward')}
                      onClick={() => onMoveLayer(layer.id, 'forward')}
                    >
                      <ChevronUp size={12} />
                    </LayerButton>
                    <LayerButton
                      disabled={documentLayerIndex <= 0}
                      label={t('paper.layers.layerBackward')}
                      onClick={() => onMoveLayer(layer.id, 'backward')}
                    >
                      <ChevronDown size={12} />
                    </LayerButton>
                  </div>
                </div>
                <div className="p-1">
                  {selectedFrameIds.length ? (
                    <button
                      className="mb-1 w-full rounded border border-cyan-300/10 px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-100/45 hover:border-cyan-300/30 hover:text-cyan-50 disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={layer.locked}
                      onClick={() => onAssignSelectionToLayer(layer.id)}
                      type="button"
                    >
                      {t('paper.layers.moveSelectionHere')}
                    </button>
                  ) : null}
                  {frames.length ? frames.map((frame) => {
                    const selected = selectedFrameIds.includes(frame.id);
                    return (
                      <PaperLayerFrameRow
                        frame={frame}
                        key={frame.id}
                        layer={layer}
                        onSelectFrame={onSelectFrame}
                        onStackFrame={onStackFrame}
                        onToggleFrameLock={onToggleFrameLock}
                        selected={selected}
                      />
                    );
                  }) : (
                    <div className="px-2 py-1.5 text-[10px] italic text-cyan-100/25">
                      {t('paper.layers.emptyLayer')}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaperLayerFrameRow({
  frame,
  layer,
  onSelectFrame,
  onStackFrame,
  onToggleFrameLock,
  selected,
}: {
  frame: PaperFrame;
  layer: PaperLayer;
  onSelectFrame: (frameId: string, additive: boolean) => void;
  onStackFrame: (frameId: string, action: Extract<PaperFrameContextActionId, 'bring-forward' | 'send-backward'>) => void;
  onToggleFrameLock: (frame: PaperFrame) => void;
  selected: boolean;
}) {
  const { t } = useI18n();
  const inherited = Boolean(frame.inherited);
  const mutationDisabled = inherited || layer.locked;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded px-1.5 py-1 ${
        selected ? 'bg-cyan-400/10' : 'hover:bg-cyan-400/5'
      }`}
      data-paper-layer-frame-id={frame.id}
    >
      <button
        aria-pressed={selected}
        className="min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!layer.visible}
        onClick={(event) => onSelectFrame(frame.id, event.shiftKey || event.ctrlKey || event.metaKey)}
        type="button"
      >
        <div className="truncate text-[11px] font-medium text-cyan-50/80">{frame.label || frame.id}</div>
        <div className="truncate text-[9px] uppercase tracking-[0.12em] text-cyan-100/30">
          {frame.kind}{inherited ? ` · ${t('paper.layers.inherited')}` : ''}
        </div>
      </button>
      <div className="flex items-center gap-0.5">
        <LayerButton
          disabled={mutationDisabled}
          label={t('paper.layers.forward')}
          onClick={() => onStackFrame(frame.id, 'bring-forward')}
        >
          <ChevronUp size={12} />
        </LayerButton>
        <LayerButton
          disabled={mutationDisabled}
          label={t('paper.layers.backward')}
          onClick={() => onStackFrame(frame.id, 'send-backward')}
        >
          <ChevronDown size={12} />
        </LayerButton>
        <LayerButton
          disabled={mutationDisabled}
          label={frame.locked ? t('paper.layers.unlock') : t('paper.layers.lock')}
          onClick={() => onToggleFrameLock(frame)}
        >
          {frame.locked ? <Lock size={11} /> : <Unlock size={11} />}
        </LayerButton>
      </div>
    </div>
  );
}

function LayerButton({ children, active, disabled, label, onClick }: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`flex h-6 w-6 items-center justify-center rounded hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-20 ${
        active ? 'text-cyan-100/75' : 'text-cyan-100/30'
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
