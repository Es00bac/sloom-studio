import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { executeNodeRequest } from './flowExecution';

function node(id: string, type: AppNode['type'], data: AppNode['data'] = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

describe('executeNodeRequest graph preflight', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports all blocking contract issues before the first provider or fetch call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const source = node('number', 'numberNode');
    const target = node('request', 'apiFetchNode', { url: 'https://example.invalid' });

    await expect(executeNodeRequest(
      target,
      { prompt: 'https://example.invalid', config: DEFAULT_EXECUTION_CONFIG },
      {} as RuntimeSettingsSnapshot,
      undefined,
      {
        graph: {
          nodes: [source, target],
          edges: [{ id: 'bad-url', source: source.id, target: target.id }],
        },
      },
    )).rejects.toThrow('number cannot connect to text');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
