import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../../store/flowStore';
import { createDefaultFunctionNodeConfig } from '../../lib/functionNodes';
import type { AppNode } from '../../types/flow';
import { CompositionNode } from './CompositionNode';

function renderCompositionNode(authoredTrackCount: number): string {
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <CompositionNode
        data={{ compositionAudioTrackCount: authoredTrackCount, onChange: () => undefined }}
        deletable
        dragging={false}
        draggable
        id="composition-1"
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selectable
        selected={false}
        type="composition"
        zIndex={0}
      />
    </ReactFlowProvider>,
  );
}

describe('CompositionNode audio track visibility (FBL-019 gap 2)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('renders a higher explicit audio track handle even when its source has not produced media yet', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'audio-1',
          type: 'audioGen',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'e1', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-3' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).toContain('data-handleid="composition-audio-3"');
  });

  it('does not render a track beyond what is authored or connected', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [],
    });

    const html = renderCompositionNode(1);

    expect(html).not.toContain('data-handleid="composition-audio-2"');
  });
});

describe('CompositionNode composition audio migration warning display (FBL-019 correction)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('derives the visible node message from a persisted composition audio migration warning when there is no live error', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <CompositionNode
          data={{
            compositionAudioTrackCount: 1,
            onChange: () => undefined,
            compositionAudioMigrationWarnings: [
              {
                handle: 'composition-audio-9',
                reason: 'overflow',
                message: 'Removed unsupported audio connection on handle "composition-audio-9" (beyond the supported 4-track limit).',
              },
            ],
          }}
          deletable
          dragging={false}
          draggable
          id="composition-1"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="composition"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('composition-audio-9');
  });
});

describe('CompositionNode Function-produced audio parity (independent review correction)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('shows the real media for a Function node whose effective result type is audio, instead of "Connect media"', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-audio-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'audio',
            result: 'https://example.test/fn-audio.mp3',
            functionNode: createDefaultFunctionNodeConfig('Narration Function'),
          },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'e1', source: 'fn-audio-1', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).toContain('Narration Function');
    // Only the still-unconnected video lane should fall back to "Connect media" (its label and
    // its empty-timeline placeholder both contain the substring, hence 2 occurrences).
    expect(html.match(/Connect media/g)).toHaveLength(2);
  });

  it('does not display a wrong-family Function result (video) as an audio track', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-video-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'video',
            result: 'https://example.test/fn-video.mp4',
            functionNode: createDefaultFunctionNodeConfig('Video Function'),
          },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'e1', source: 'fn-video-1', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).not.toContain('Video Function');
    // Both the video lane and the audio-1 lane render as unconnected (label + empty-timeline
    // placeholder each contain the substring, hence 4 occurrences across the 2 lanes).
    expect(html.match(/Connect media/g)).toHaveLength(4);
  });

  it('shows a correct-family Function video on the video lane', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-video-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'video',
            result: 'https://example.test/fn-video.mp4',
            functionNode: createDefaultFunctionNodeConfig('Rendered Function Video'),
          },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'e1', source: 'fn-video-1', target: 'composition-1', targetHandle: 'composition-video' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).toContain('Rendered Function Video');
  });

  it('does not display a wrong-family Function audio result on the video lane', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-audio-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'audio',
            result: 'https://example.test/fn-audio.mp3',
            functionNode: createDefaultFunctionNodeConfig('Wrong-family Audio Function'),
          },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'e1', source: 'fn-audio-1', target: 'composition-1', targetHandle: 'composition-video' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).not.toContain('Wrong-family Audio Function');
  });

  it('shows Function audio routed through a Portal when execution can consume it', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-audio-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'audio',
            result: 'https://example.test/portal-function.mp3',
            functionNode: createDefaultFunctionNodeConfig('Portal Narration'),
          },
        },
        {
          id: 'portal-entry',
          type: 'portal',
          position: { x: 0, y: 0 },
          data: { portalRole: 'entry', portalPairId: 'pair-1' },
        },
        {
          id: 'portal-exit',
          type: 'portal',
          position: { x: 0, y: 0 },
          data: { portalRole: 'exit', portalPairId: 'pair-1' },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'into-portal', source: 'fn-audio-1', target: 'portal-entry' },
        { id: 'out-of-portal', source: 'portal-exit', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    const html = renderCompositionNode(1);

    expect(html).toContain('Portal Narration');
  });

  it('does not display Function audio routed from an inactive Fork output', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'fn-audio-1',
          type: 'functionNode',
          position: { x: 0, y: 0 },
          data: {
            resultType: 'audio',
            result: 'https://example.test/inactive-function.mp3',
            functionNode: createDefaultFunctionNodeConfig('Inactive Fork Narration'),
          },
        },
        {
          id: 'fork-1',
          type: 'forkSwitchNode',
          position: { x: 0, y: 0 },
          data: { selectedOutput: 'A' },
        },
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        },
      ] as AppNode[],
      edges: [
        { id: 'into-fork', source: 'fn-audio-1', target: 'fork-1', targetHandle: 'input' },
        { id: 'inactive-output', source: 'fork-1', sourceHandle: 'B', target: 'composition-1', targetHandle: 'composition-audio-1' },
      ],
    });

    const html = renderCompositionNode(1);

    expect(html).not.toContain('Inactive Fork Narration');
  });
});
