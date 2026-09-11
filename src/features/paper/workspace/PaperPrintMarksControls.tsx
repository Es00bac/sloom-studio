import type { PaperPrintJobInfo, PaperPrintMarksSpec } from '../../../types/paper';
import { useI18n } from '../../../lib/useI18n';

export interface PaperPrintMarksControlsProps {
  marks: PaperPrintMarksSpec;
  jobInfo: PaperPrintJobInfo;
  onChange: (patch: Partial<PaperPrintMarksSpec>) => void;
  onJobInfoChange: (patch: Partial<PaperPrintJobInfo>) => void;
}

/** Explicit production-sheet controls. Kept separate from the workspace so export settings stay testable. */
export function PaperPrintMarksControls({ jobInfo, marks, onChange, onJobInfoChange }: PaperPrintMarksControlsProps) {
  const { t } = useI18n();

  return (
    <div className="mt-3 border-t border-cyan-300/10 pt-3" data-paper-print-marks-controls="true">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">
        {t('paper.insp.printMarks')}
      </div>
      <label className="flex items-center gap-2 text-xs text-cyan-100/55">
        <input
          checked={marks.cropMarks}
          onChange={(event) => onChange({ cropMarks: event.target.checked })}
          type="checkbox"
        />
        {t('paper.insp.cropMarks')}
      </label>
      {marks.cropMarks ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PrintMarkNumberField
            label={t('paper.insp.cropMarkLength')}
            max={20}
            min={2}
            onChange={(cropMarkLengthMm) => onChange({ cropMarkLengthMm })}
            step={0.5}
            value={marks.cropMarkLengthMm}
          />
          <PrintMarkNumberField
            label={t('paper.insp.cropMarkOffset')}
            max={20}
            min={0}
            onChange={(cropMarkOffsetMm) => onChange({ cropMarkOffsetMm })}
            step={0.5}
            value={marks.cropMarkOffsetMm}
          />
          <PrintMarkNumberField
            label={t('paper.insp.cropMarkStroke')}
            max={2}
            min={0.1}
            onChange={(cropMarkStrokePt) => onChange({ cropMarkStrokePt })}
            step={0.05}
            value={marks.cropMarkStrokePt}
          />
        </div>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/55">
        <input
          checked={marks.registrationMarks}
          onChange={(event) => onChange({ registrationMarks: event.target.checked })}
          type="checkbox"
        />
        {t('paper.insp.registrationMarks')}
      </label>
      <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/55">
        <input
          checked={marks.colorBars}
          onChange={(event) => onChange({ colorBars: event.target.checked })}
          type="checkbox"
        />
        {t('paper.insp.colorBars')}
      </label>
      <div className="mt-2">
        <PrintMarkNumberField
          label={t('paper.insp.slugArea')}
          max={100}
          min={0}
          onChange={(slugAreaMm) => onChange({ slugAreaMm })}
          step={1}
          value={marks.slugAreaMm}
        />
      </div>
      {marks.slugAreaMm > 0 ? (
        <div className="mt-2 space-y-2 rounded border border-cyan-300/10 bg-[#08111e]/60 p-2" data-paper-slug-job-info="true">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">
            {t('paper.insp.slugJobInfo')}
          </div>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <PrintMarkTextField label={t('paper.insp.jobName')} onChange={(jobName) => onJobInfoChange({ jobName })} value={jobInfo.jobName} />
            <PrintMarkTextField label={t('paper.insp.jobNumber')} onChange={(jobNumber) => onJobInfoChange({ jobNumber })} value={jobInfo.jobNumber} />
            <PrintMarkTextField label={t('paper.insp.client')} onChange={(client) => onJobInfoChange({ client })} value={jobInfo.client} />
            <PrintMarkTextField label={t('paper.insp.author')} onChange={(author) => onJobInfoChange({ author })} value={jobInfo.author} />
          </div>
          <PrintMarkTextField label={t('paper.insp.jobNotes')} onChange={(notes) => onJobInfoChange({ notes })} value={jobInfo.notes} />
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-cyan-100/35">{t('paper.insp.printMarksHelp')}</p>
    </div>
  );
}

function PrintMarkTextField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs text-cyan-100/55">
      <span className="mb-1 block">{label}</span>
      <input
        className="paper-input"
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function PrintMarkNumberField({
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
    <label className="block text-xs text-cyan-100/55">
      <span className="mb-1 block">{label}</span>
      <input
        className="paper-input"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={Number((Number.isFinite(value) ? value : min).toFixed(2))}
      />
    </label>
  );
}
