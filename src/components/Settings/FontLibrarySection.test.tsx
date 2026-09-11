// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryPaperAssetRepository } from '../../features/paper/assets/PaperAssetRepository';
import { createOpenFontCatalogClient, type OpenFontLibraryFace } from '../../lib/paperOpenFontCatalog';
import { FontLibrarySection } from './FontLibrarySection';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('FontLibrarySection', () => {
  afterEach(() => {
    delete window.signalLoomNative;
    delete (globalThis as typeof globalThis & { queryLocalFonts?: unknown }).queryLocalFonts;
  });

  it('discovers local font names only after the explicit button action', async () => {
    const queryLocalFonts = vi.fn(async () => [{
      family: 'Local Sans',
      fullName: 'Local Sans Regular',
      postscriptName: 'LocalSans-Regular',
      style: 'normal',
      blob: vi.fn(),
    }]);
    (globalThis as typeof globalThis & { queryLocalFonts?: unknown }).queryLocalFonts = queryLocalFonts;
    const catalog = createOpenFontCatalogClient({ fetchImpl: vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch });
    const host = document.createElement('div');
    const root: Root = createRoot(host);

    await act(async () => {
      root.render(<FontLibrarySection catalog={catalog} library={[]} onInstall={vi.fn()} repository={new MemoryPaperAssetRepository()} />);
    });
    expect(queryLocalFonts).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[name="discover-local-fonts"]')?.click();
    });

    expect(queryLocalFonts).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('1 installed font discovered locally');
    expect(host.textContent).toContain('Local Sans Regular');
    await act(async () => root.unmount());
  });

  it('omits the bundled-library card when the dedicated transport reports no root while keeping online/user font controls (FBL-025)', async () => {
    const bundledFontLibraryStatus = vi.fn(async () => ({ available: false }));
    window.signalLoomNative = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus,
    } as never;
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    const globalFetchSpy = vi.fn(async () => new Response('not found', { status: 404 }));
    globalThis.fetch = globalFetchSpy as unknown as typeof fetch;
    const catalog = createOpenFontCatalogClient({ fetchImpl });
    const repository = new MemoryPaperAssetRepository();
    const host = document.createElement('div');
    const root: Root = createRoot(host);

    try {
      await act(async () => {
        root.render(<FontLibrarySection catalog={catalog} library={[]} onInstall={vi.fn()} repository={repository} />);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(host.textContent).not.toContain('Sloom publishing font library');
      expect(host.textContent).not.toContain('Browse bundled fonts');
      expect(host.querySelector('button[name="browse-open-fonts"]')).not.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(globalFetchSpy).not.toHaveBeenCalled();
      expect(bundledFontLibraryStatus).toHaveBeenCalledTimes(1);

      await act(async () => root.unmount());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows the bundled-library card with a complete Electron bridge (FBL-025)', async () => {
    const bundledFontLibraryStatus = vi.fn(async () => ({ available: true }));
    window.signalLoomNative = { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus } as never;
    const catalog = createOpenFontCatalogClient({ fetchImpl: vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch });
    const repository = new MemoryPaperAssetRepository();
    const host = document.createElement('div');
    const root: Root = createRoot(host);

    await act(async () => {
      root.render(<FontLibrarySection catalog={catalog} library={[]} onInstall={vi.fn()} repository={repository} />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Sloom publishing font library'));
    });

    expect(host.textContent).toContain('Sloom publishing font library');
    expect(host.textContent).toContain('Browse bundled fonts');
    expect(bundledFontLibraryStatus).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('browses and downloads an open font only after explicit user actions', async () => {
    const fontBytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.fontsource.org/v1/fonts') {
        return jsonResponse([{ id: 'liberation-sans', family: 'Liberation Sans', subsets: ['latin'], weights: [400], styles: ['normal'], defSubset: 'latin' }]);
      }
      if (url === 'https://api.fontsource.org/v1/fonts/liberation-sans') {
        return jsonResponse({ id: 'liberation-sans', family: 'Liberation Sans', subsets: ['latin'], weights: [400], styles: ['normal'], defSubset: 'latin' });
      }
      if (url === 'https://api.fontsource.org/v1/version/liberation-sans') return jsonResponse({ version: '1.2.3' });
      if (url.endsWith('/metadata.json')) return jsonResponse({ license: 'OFL-1.1', attribution: 'Liberation Fonts' });
      if (url.endsWith('/LICENSE')) return new Response('SIL OPEN FONT LICENSE Version 1.1\n', { status: 200 });
      if (url.endsWith('.ttf')) return new Response(fontBytes, { status: 200, headers: { 'content-type': 'font/ttf' } });
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    const catalog = createOpenFontCatalogClient({ fetchImpl });
    const repository = new MemoryPaperAssetRepository();
    const host = document.createElement('div');
    const root: Root = createRoot(host);

    function Harness() {
      const [library, setLibrary] = useState<OpenFontLibraryFace[]>([]);
      return (
        <FontLibrarySection
          catalog={catalog}
          library={library}
          onInstall={(face) => setLibrary((current) => [...current, face])}
          onRemove={(fontAssetSha256) => setLibrary((current) => current.filter((entry) => entry.face.fontAsset.sha256 !== fontAssetSha256))}
          repository={repository}
        />
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[name="browse-open-fonts"]')?.click();
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.fontsource.org/v1/fonts', expect.any(Object));
    expect(host.textContent).toContain('Liberation Sans');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[name="select-open-font-liberation-sans"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[name="download-open-font-liberation-sans-400-normal"]')?.click();
    });

    await vi.waitFor(() => expect(host.textContent).toContain('Available offline'));
    expect(await repository.listRefs()).toHaveLength(2);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label^="Remove Liberation Sans"]')?.click();
    });
    await vi.waitFor(() => expect(host.querySelector('button[aria-label^="Remove Liberation Sans"]')).toBeNull());
    expect(host.querySelector<HTMLButtonElement>('button[name="download-open-font-liberation-sans-400-normal"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
