import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Handle as ReactFlowHandle } from '@xyflow/react';
import type { FlowPortContract } from '../../lib/flowNodeContracts';
import {
  TypedHandle,
} from './TypedHandle';
import { getTypedHandlePresentation } from './typedHandlePresentation';

vi.mock('@xyflow/react', () => ({
  Handle: ({ isConnectable, ...props }: Record<string, unknown>) => (
    <div {...props} data-connectable={String(isConnectable)} />
  ),
  useNodeId: () => null,
}));

function port(overrides: Partial<FlowPortContract> = {}): FlowPortContract {
  return {
    id: 'image',
    direction: 'input',
    label: 'Image',
    help: 'Accepts image.',
    types: [{ kind: 'image' }],
    required: false,
    minConnections: 0,
    maxConnections: 1,
    ordered: false,
    side: 'left',
    ...overrides,
  };
}

describe('getTypedHandlePresentation', () => {
  it('uses the same color vocabulary as carried edge values', () => {
    expect(getTypedHandlePresentation(port())).toMatchObject({
      color: '#34d399',
      direction: 'input',
      typeLabel: 'image',
    });
    expect(getTypedHandlePresentation(port({
      direction: 'output',
      types: [{ kind: 'list', item: { kind: 'text' } }],
    }))).toMatchObject({
      color: '#22d3ee',
      direction: 'output',
      typeLabel: 'list<text>',
    });
  });

  it('prefers the actual connected payload for a union input', () => {
    expect(getTypedHandlePresentation(port({ types: [{ kind: 'text' }, { kind: 'image' }] }), { kind: 'image' }))
      .toMatchObject({ color: '#34d399', typeLabel: 'image' });
  });
});

describe('TypedHandle', () => {
  it('is the only handle renderer used by Flow node components', () => {
    const directory = new URL('.', import.meta.url);
    const offenders = readdirSync(directory)
      .filter((file) => file.endsWith('.tsx') && !file.startsWith('TypedHandle'))
      .filter((file) => {
        const source = readFileSync(new URL(file, directory), 'utf8');
        return source.includes('<Handle') && !source.includes("TypedHandle as Handle");
      });

    expect(offenders).toEqual([]);
  });

  it('keeps unsupported ports visible but blocks connection with an accessible reason', () => {
    const contract = port({ disabledReason: 'This model does not support reference images.' });
    const props = {
      id: 'image',
      type: 'target',
      position: 'left',
      contract,
    } as unknown as ComponentProps<typeof TypedHandle>;
    const markup = renderToStaticMarkup(<TypedHandle {...props} />);

    expect(markup).toContain('data-connectable="false"');
    expect(markup).toContain('data-flow-port-disabled="true"');
    expect(markup).toContain('title="Image · image · This model does not support reference images."');
    expect(markup).toContain('background-color:#34d399');
  });

  it('gives source and target handles distinct direction classes', () => {
    const sourceContract = port({ direction: 'output' });
    const props = {
      id: 'image',
      type: 'source',
      position: 'right',
      contract: sourceContract,
    } as unknown as ComponentProps<typeof ReactFlowHandle> & { contract: FlowPortContract };
    const markup = renderToStaticMarkup(<TypedHandle {...props} />);

    expect(markup).toContain('typed-flow-handle--source');
    expect(markup).toContain('data-flow-port-direction="output"');
  });
});
