import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../store/settingsStore';
import { AudioNode } from './AudioNode';

describe('AudioNode provider selection', () => {
  it('keeps an unconfigured provider and model selectable while blocking execution', () => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({ apiKeys: { ...settings.apiKeys, elevenlabs: '' } });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <AudioNode
          data={{
            mediaMode: 'generate',
            provider: 'elevenlabs',
            modelId: 'eleven_multilingual_v2',
            onChange: () => undefined,
            onRun: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="audio-1"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="audioGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('<option value="elevenlabs" selected="">ElevenLabs</option>');
    expect(html).toContain('Configure ElevenLabs in Settings to run this model');
    expect(html).toContain('title="Configure ElevenLabs in Settings before running this node."');
  });
});
