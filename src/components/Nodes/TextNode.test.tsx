import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppNode, TextProvider } from '../../types/flow';
import { TextNode } from './TextNode';

function generatedNode(modelId: string, provider: TextProvider = 'gemini'): AppNode {
  return {
    id: 'text-model-1',
    type: 'textNode',
    position: { x: 0, y: 0 },
    data: { mode: 'generate', provider, modelId },
  };
}

function renderGeneratedTextNode(modelId: string, provider: TextProvider = 'gemini'): string {
  useFlowStore.setState({ nodes: [generatedNode(modelId, provider)], edges: [] });
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <TextNode
        data={{ mode: 'generate', provider, modelId, onChange: () => undefined }}
        deletable
        dragging={false}
        draggable
        id="text-model-1"
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selectable
        selected={false}
        type="textNode"
        zIndex={0}
      />
    </ReactFlowProvider>,
  );
}

describe('TextNode prompt editor expansion', () => {
  it('renders a larger-editor affordance for prompt-mode text input', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <TextNode
          data={{
            mode: 'prompt',
            prompt: 'A longer prompt that needs room.',
            onChange: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="text-1"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="textNode"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('aria-label="Open Prompt Editor"');
  });
});

describe('TextNode model-specific controls', () => {
  beforeEach(() => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({
      apiKeys: { ...settings.apiKeys, gemini: 'test-key' },
    });
  });

  it('keeps preview models selectable and warns about their lifecycle', () => {
    expect(renderGeneratedTextNode('gemini-3.1-pro-preview')).toContain(
      'Gemini 3.1 Pro Preview is a preview model',
    );
  });

  it('keeps Gemini 3-only controls visible but disabled on Gemini 2.5', () => {
    const html = renderGeneratedTextNode('gemini-2.5-flash');

    expect(html).toContain('Gemini 2.5 Flash does not expose Thinking level.');
    expect(html).toContain('Gemini 2.5 Flash does not expose Media resolution.');
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*title="Gemini 2.5 Flash does not expose Thinking level\./);
  });

  it('keeps unconfigured providers and models selectable while blocking Run', () => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({ apiKeys: { ...settings.apiKeys, openai: '' } });
    const html = renderGeneratedTextNode('gpt-5.6-terra', 'openai');

    expect(html).toContain('<option value="openai" selected="">OpenAI / Compatible</option>');
    expect(html).toContain('Configure OpenAI / Compatible in Settings to run this model');
  });
});
