import type { PaperBubbleConnectorGeometry, PaperFrame } from '../../../types/paper';
import { buildPaperBubbleConnectorSegments } from '../../../lib/paperBubbleChains';
import { useI18n } from '../../../lib/useI18n';

export interface PaperBubbleConnectorControlsProps {
  frame: PaperFrame;
  pageFrames: PaperFrame[];
  onUpdate: (ownerFrameId: string, geometry: PaperBubbleConnectorGeometry | undefined) => void;
}

export function PaperBubbleConnectorControls({
  frame,
  pageFrames,
  onUpdate,
}: PaperBubbleConnectorControlsProps) {
  const { t } = useI18n();
  const segments = buildPaperBubbleConnectorSegments(pageFrames);
  const segment = segments.find((candidate) => candidate.style === 'bridge' && candidate.toFrameId === frame.id)
    ?? segments.find((candidate) => candidate.style === 'bridge' && candidate.fromFrameId === frame.id);
  if (!segment) return null;
  const geometry = segment.geometry;
  const ownerFrameId = segment.toFrameId;
  const update = (patch: Partial<PaperBubbleConnectorGeometry>) => onUpdate(ownerFrameId, { ...geometry, ...patch });

  return (
    <div
      className="rounded-lg border border-fuchsia-300/15 bg-[#0b121d] p-2"
      data-paper-bubble-connector-controls="true"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-100/55">
        {t('paper.insp.connectorShape')}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-cyan-100/50">
        {t('paper.insp.connectorShapeHelp')}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-cyan-100/35">
        {t('paper.insp.connectorTailHelp')}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button
          className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[10px] text-cyan-100/70"
          onClick={() => onUpdate(ownerFrameId, undefined)}
          type="button"
        >
          {t('paper.insp.connectorOrganic')}
        </button>
        <button
          className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[10px] text-cyan-100/70"
          onClick={() => update({ control1OffsetPercent: 0, control2OffsetPercent: 0 })}
          type="button"
        >
          {t('paper.insp.connectorStraight')}
        </button>
        <button
          className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[10px] text-cyan-100/70"
          onClick={() => update({ control1OffsetPercent: 10, control2OffsetPercent: -10 })}
          type="button"
        >
          {t('paper.insp.connectorSCurve')}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <ConnectorNumberField
          label={t('paper.insp.connectorWidth')}
          max={50}
          min={0.8}
          onChange={(widthMm) => update({ widthMm })}
          step={0.25}
          value={geometry.widthMm}
        />
        <ConnectorNumberField
          label={t('paper.insp.connectorTaper')}
          max={100}
          min={0}
          onChange={(taperPercent) => update({ taperPercent })}
          step={5}
          value={geometry.taperPercent}
        />
        <ConnectorNumberField
          label={t('paper.insp.connectorFromAngle')}
          max={359}
          min={0}
          onChange={(fromAngleDeg) => update({ fromAngleDeg })}
          step={5}
          value={geometry.fromAngleDeg}
        />
        <ConnectorNumberField
          label={t('paper.insp.connectorToAngle')}
          max={359}
          min={0}
          onChange={(toAngleDeg) => update({ toAngleDeg })}
          step={5}
          value={geometry.toAngleDeg}
        />
        <ConnectorNumberField
          label={t('paper.insp.connectorCurveOne')}
          max={100}
          min={-100}
          onChange={(control1OffsetPercent) => update({ control1OffsetPercent })}
          step={2.5}
          value={geometry.control1OffsetPercent}
        />
        <ConnectorNumberField
          label={t('paper.insp.connectorCurveTwo')}
          max={100}
          min={-100}
          onChange={(control2OffsetPercent) => update({ control2OffsetPercent })}
          step={2.5}
          value={geometry.control2OffsetPercent}
        />
      </div>
    </div>
  );
}

function ConnectorNumberField({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="block text-[10px] font-semibold text-cyan-100/55">
      {label}
      <input
        aria-label={label}
        className="paper-input mt-1"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
        }}
        step={step}
        type="number"
        value={Number(value.toFixed(3))}
      />
    </label>
  );
}
