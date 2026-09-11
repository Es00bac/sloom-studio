import { memo, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { VideoDurationSlider } from './VideoDurationSlider';
import {
  AUDIO_OUTPUT_FORMAT_OPTIONS,
  IMAGE_ASPECT_RATIO_OPTIONS,
  IMAGE_STEP_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} from '../../lib/providerCatalog';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import type { AppNodeProps } from '../../types/flow';

const selectClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none shadow-inner',
);

function ConfigNodeComponent({ data }: AppNodeProps) {
  return (
    <BaseNode
      icon={SlidersHorizontal}
      nodeType="settings"
      title="Generation Defaults"
      hasInput={false}
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-3">
        <FieldLabel label="Aspect Ratio">
          <select
            className={selectClassName}
            onChange={(event) => data.onChange?.('aspectRatio', event.target.value)}
            value={data.aspectRatio ?? '1:1'}
          >
            {IMAGE_ASPECT_RATIO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Image Steps">
          <select
            className={selectClassName}
            onChange={(event) => data.onChange?.('steps', Number(event.target.value))}
            value={String(data.steps ?? 30)}
          >
            {IMAGE_STEP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Video Duration">
          <div className="rounded-lg border border-gray-700/60 bg-[#111217]/50 px-2 py-2 shadow-inner">
            <VideoDurationSlider
              onChange={(value) => data.onChange?.('durationSeconds', value)}
              value={Number(data.durationSeconds ?? 6)}
            />
          </div>
        </FieldLabel>

        <FieldLabel label="Video Resolution">
          <select
            className={selectClassName}
            onChange={(event) => data.onChange?.('videoResolution', event.target.value)}
            value={data.videoResolution ?? '720p'}
          >
            {VIDEO_RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Audio Output">
          <select
            className={selectClassName}
            onChange={(event) => data.onChange?.('audioOutputFormat', event.target.value)}
            value={data.audioOutputFormat ?? 'mp3_44100_128'}
          >
            {AUDIO_OUTPUT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldLabel>
      </div>
    </BaseNode>
  );
}

export const ConfigNode = memo(ConfigNodeComponent);

interface FieldLabelProps {
  label: string;
  children: ReactNode;
}

function FieldLabel({ label, children }: FieldLabelProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{label}</label>
      {children}
    </div>
  );
}
