import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshProviderBalances } from './providerBalance';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('providerBalance', () => {
  it('fetches BFL and Stability credit balances when API keys are configured', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.bfl.ai')) {
        return new Response(JSON.stringify({ credits: 123.4 }), { status: 200 });
      }
      if (url.includes('api.stability.ai')) {
        return new Response(JSON.stringify({ credits: 45 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const balances = await refreshProviderBalances({
      bfl: 'bfl-key',
      stability: 'stability-key',
    });

    expect(balances.map((balance) => [balance.provider, balance.status, balance.credits, balance.estimatedUsd])).toEqual([
      ['bfl', 'available', 123.4, 1.234],
      ['stability', 'available', 45, 0.45],
      ['gemini', 'unsupported', undefined, undefined],
      ['openai', 'unsupported', undefined, undefined],
      ['huggingface', 'unsupported', undefined, undefined],
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.bfl.ai/v1/credits', expect.objectContaining({
      headers: expect.objectContaining({ 'x-key': 'bfl-key' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('https://api.stability.ai/v1/user/balance', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer stability-key' }),
    }));
  });

  it('reports unconfigured and unavailable balances without throwing', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const balances = await refreshProviderBalances({ bfl: '', stability: 'bad-key' });

    expect(balances.find((balance) => balance.provider === 'bfl')).toMatchObject({
      status: 'unconfigured',
    });
    expect(balances.find((balance) => balance.provider === 'stability')).toMatchObject({
      status: 'error',
    });
  });
});
