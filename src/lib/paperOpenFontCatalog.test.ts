import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  createOpenFontCatalogClient,
  downloadOpenFontFace,
} from './paperOpenFontCatalog';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function responseWithUrl(body: BodyInit | null, url: string, options: ResponseInit = {}): Response {
  const response = new Response(body, options);
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function catalogFetch(options: {
  license?: unknown;
  licenseText?: string;
  licenseUrl?: string;
  version?: string;
} = {}): typeof fetch {
  const fontBytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.fontsource.org/v1/fonts') {
      return jsonResponse([{ id: 'liberation-sans', family: 'Liberation Sans', subsets: ['latin'], weights: [400], styles: ['normal'], defSubset: 'latin' }]);
    }
    if (url === 'https://api.fontsource.org/v1/fonts/liberation-sans') {
      return jsonResponse({ id: 'liberation-sans', family: 'Liberation Sans', subsets: ['latin'], weights: [400], styles: ['normal'], defSubset: 'latin' });
    }
    if (url === 'https://api.fontsource.org/v1/version/liberation-sans') {
      return jsonResponse({ latest: options.version ?? '1.2.3', static: [options.version ?? '1.2.3'] });
    }
    if (url === 'https://cdn.jsdelivr.net/npm/@fontsource/liberation-sans@1.2.3/metadata.json') {
      return jsonResponse({ license: options.license ?? 'OFL-1.1', attribution: 'Liberation Fonts' });
    }
    if (url === 'https://cdn.jsdelivr.net/npm/@fontsource/liberation-sans@1.2.3/LICENSE') {
      return options.licenseUrl
        ? responseWithUrl(options.licenseText ?? 'SIL OPEN FONT LICENSE Version 1.1\n', options.licenseUrl, { status: 200 })
        : new Response(options.licenseText ?? 'SIL OPEN FONT LICENSE Version 1.1\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url === 'https://cdn.jsdelivr.net/fontsource/fonts/liberation-sans@1.2.3/latin-400-normal.ttf') {
      return new Response(fontBytes, { status: 200, headers: { 'content-type': 'font/ttf' } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('Paper open font catalog', () => {
  it('does not contact Fontsource until catalog browse is requested', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    const client = createOpenFontCatalogClient({ fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    await client.listFamilies();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.fontsource.org/v1/fonts',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a face without an authoritative license record', async () => {
    const client = createOpenFontCatalogClient({ fetchImpl: catalogFetch({ license: '' }) });

    await expect(client.downloadFace('liberation-sans', 400, 'normal')).rejects.toThrow(/license/i);
  });

  it('rejects an unpinned package redirect and a mismatched license text', async () => {
    const redirected = createOpenFontCatalogClient({
      fetchImpl: catalogFetch({ licenseUrl: 'https://cdn.jsdelivr.net/npm/@fontsource/liberation-sans/LICENSE' }),
    });
    await expect(redirected.downloadFace('liberation-sans', 400, 'normal')).rejects.toThrow(/pinned package identity/i);

    const mismatched = createOpenFontCatalogClient({
      fetchImpl: catalogFetch({ license: 'MIT' }),
    });
    await expect(mismatched.downloadFace('liberation-sans', 400, 'normal')).rejects.toThrow(/does not match/i);
  });

  it('requires a strict semantic package version before fetching package files', async () => {
    const client = createOpenFontCatalogClient({ fetchImpl: catalogFetch({ version: 'v1.2.3' }) });

    await expect(client.downloadFace('liberation-sans', 400, 'normal')).rejects.toThrow(/strict package version/i);
  });

  it('pins and stores a vetted face plus its authoritative license evidence', async () => {
    const repository = new MemoryPaperAssetRepository();
    const fetchImpl = catalogFetch();
    const downloaded = await downloadOpenFontFace({
      id: 'liberation-sans',
      weight: 400,
      style: 'normal',
      repository,
      fetchImpl,
      now: () => 1234,
    });

    expect(downloaded.retrievedAt).toBe(1234);
    expect(downloaded.face.source).toEqual({
      kind: 'open-catalog',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/liberation-sans@1.2.3/latin-400-normal.ttf',
      version: '1.2.3',
    });
    expect(downloaded.face.license).toMatchObject({ id: 'OFL-1.1', attribution: 'Liberation Fonts' });
    expect(downloaded.face.license.textAsset).toBeDefined();
    expect(await repository.listRefs()).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.fontsource.org/v1/version/liberation-sans',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/@fontsource/liberation-sans@1.2.3/metadata.json',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/@fontsource/liberation-sans@1.2.3/LICENSE',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/fontsource/fonts/liberation-sans@1.2.3/latin-400-normal.ttf',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
