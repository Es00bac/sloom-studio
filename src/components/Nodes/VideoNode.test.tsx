import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppNode, VideoProvider } from '../../types/flow';
import { getVideoCredentialRouteWarning, getVideoModelContract } from '../../lib/modelContracts/videoModelContracts';
import { VideoNode } from './VideoNode';

function node(modelId: string, provider: VideoProvider = 'gemini'): AppNode {
  return {
    id: 'video-1',
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: { mediaMode: 'generate', provider, modelId },
  };
}

function renderVideoNode(modelId: string, provider: VideoProvider = 'gemini'): string {
  useFlowStore.setState({ nodes: [node(modelId, provider)], edges: [] });
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <VideoNode
        data={{ mediaMode: 'generate', provider, modelId, onChange: () => undefined }}
        deletable
        dragging={false}
        draggable
        id="video-1"
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selectable
        selected={false}
        type="videoGen"
        zIndex={0}
      />
    </ReactFlowProvider>,
  );
}

describe('VideoNode model-specific UX', () => {
  beforeEach(() => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({
      apiKeys: { ...settings.apiKeys, gemini: 'test-key' },
      providerSettings: {
        ...settings.providerSettings,
        geminiCredentialMode: 'api-key',
      },
    });
  });

  it('keeps Omni selectable while visibly blocking Veo-only controls', () => {
    const html = renderVideoNode('gemini-omni-flash-preview');

    expect(html).toContain('Gemini Omni Flash Preview is a preview model');
    expect(html).toContain('does not support first/last-frame interpolation');
    expect(html).toContain('Interactions API');
    expect(html).toContain('Output is 720p and 3–10 seconds');
    expect(html).toContain('Negative prompt unsupported');
  });

  it('keeps Veo Lite selectable and explains unsupported reference/extension inputs', () => {
    const html = renderVideoNode('veo-3.1-lite-generate-preview');

    expect(html).toContain('Veo 3.1 Lite Preview (Gemini API) is a preview model');
    expect(html).toContain('does not support reference-image guidance');
    expect(html).toContain('does not support video extension or video editing');
  });

  it('warns when a Vertex-only model is selected with API-key credentials', () => {
    expect(getVideoCredentialRouteWarning(
      getVideoModelContract('gemini', 'veo-3.1-generate-001'),
      'api-key',
    )).toContain('This -001 model ID is a Vertex route');
  });

  it('keeps an unconfigured provider selectable while blocking execution', () => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({ apiKeys: { ...settings.apiKeys, huggingface: '' } });
    const html = renderVideoNode('Wan-AI/Wan2.2-T2V-A14B', 'huggingface');

    expect(html).toContain('<option value="huggingface" selected="">Hugging Face</option>');
    expect(html).toContain('Configure Hugging Face in Settings to run this model');
  });
});
