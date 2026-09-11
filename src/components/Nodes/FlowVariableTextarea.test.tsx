import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppNode } from '../../types/flow';
import { useFlowStore } from '../../store/flowStore';
import { FlowVariableTextarea } from './FlowVariableTextarea';

describe('FlowVariableTextarea expanded editor', () => {
  afterEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it('renders an icon affordance for opening a larger editor when expansion is enabled', () => {
    const html = renderToStaticMarkup(
      <FlowVariableTextarea
        className="textarea"
        expandedTitle="Prompt Editor"
        onChange={() => undefined}
        value="A long prompt"
      />,
    );

    expect(html).toContain('aria-label="Open Prompt Editor"');
  });

  it('can render a large dialog editor seeded with the same text value', () => {
    const html = renderToStaticMarkup(
      <FlowVariableTextarea
        className="textarea"
        defaultExpanded
        expandedTitle="Prompt Editor"
        onChange={() => undefined}
        value="A long prompt"
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Prompt Editor');
    expect(html).toContain('rows="18"');
    expect(html).toContain('A long prompt');
  });

  it('renders declared variables in the expanded editor reference rail', () => {
    useFlowStore.setState({
      edges: [],
      nodes: [
        {
          id: 'image-1',
          type: 'imageGen',
          position: { x: 0, y: 0 },
          data: {
            resultHistory: [{
              id: 'attempt-1',
              result: 'data:image/png;base64,POSE',
              resultType: 'image',
              statusMessage: 'Generated image',
              createdAt: '2026-06-04T12:00:00.000Z',
              variableName: 'hero_pose',
            }],
          },
        } as AppNode,
        {
          id: 'envelope-1',
          type: 'envelope',
          position: { x: 0, y: 0 },
          data: {
            flowVariableName: 'panel_refs',
            envelopeItems: [
              { id: 'item-1', index: 0, kind: 'text', label: 'Wide shot', value: 'wide establishing shot' },
              { id: 'item-2', index: 1, kind: 'text', label: 'Close shot', value: 'close-up reaction' },
            ],
          },
        } as AppNode,
      ],
    });

    const html = renderToStaticMarkup(
      <FlowVariableTextarea
        className="textarea"
        defaultExpanded
        expandedTitle="Prompt Editor"
        onChange={() => undefined}
        value="Use "
      />,
    );

    expect(html).toContain('data-flow-variable-reference-rail="true"');
    expect(html).toContain('Available Variables');
    expect(html).toContain('{{hero_pose}}');
    expect(html).toContain('{{panel_refs[*]}}');
    expect(html).toContain('{{panel_refs[1]}}');
    expect(html).toContain('{{panel_refs[2]}}');
  });
});
