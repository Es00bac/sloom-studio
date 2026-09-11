// @vitest-environment jsdom

import { act } from 'react';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_TYPOGRAPHY } from '../../../lib/paperDocument';
import { getSignalLoomNativeBridge } from '../../../lib/nativeApp';
import { PaperBundledFontPicker } from './PaperBundledFontPicker';

const testFontBytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));

const mocks = vi.hoisted(() => ({
  addImportedFont: vi.fn(),
  installBundledPaperFontFace: vi.fn(),
  family: {
    id: 'base:paper-authority',
    family: 'Liberation Sans',
    slug: 'paper-authority',
    collection: 'base',
    role: 'sans',
    sourceUrl: 'https://example.test',
    sourceVersion: '1',
    licenseId: 'OFL-1.1',
    licenseFile: 'LICENSE',
    licenseSha256: 'a'.repeat(64),
    licenseByteLength: 1,
    warnings: [],
    faces: [],
  },
  face: {
    id: 'paper-authority:regular',
    file: 'collection/base/paper-authority/Regular.ttf',
    collectionIndex: 0,
    sha256: 'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee',
    byteLength: 410820,
    family: 'Liberation Sans',
    subfamily: 'Regular',
    fullName: 'Liberation Sans Regular',
    postscriptName: 'PaperAuthoritySans-Regular',
    version: '1',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    glyphCount: 1,
    variable: false,
    axes: {},
    canSubset: true,
    hasVerticalSubstitution: false,
  },
}));

vi.mock('../../../lib/bundledFontLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/bundledFontLibrary')>();
  return { ...actual, installBundledPaperFontFace: mocks.installBundledPaperFontFace };
});

vi.mock('../../../store/paperStore', () => ({
  capturePaperInspectorStoreAuthority: () => ({ generation: 0 }),
  isPaperInspectorStoreAuthorityCurrent: () => true,
  usePaperStore: (selector: (state: { addImportedFont: typeof mocks.addImportedFont }) => unknown) => selector({ addImportedFont: mocks.addImportedFont }),
}));

vi.mock('../assets/PaperAssetRuntime', () => ({ paperAssetRepository: {} }));

function bridge() {
  return {
    getNativeState: vi.fn(),
    onMenuCommand: vi.fn(),
    bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
  };
}

function inventoryResponse() {
  return {
    schemaVersion: 1,
    catalogFamilyCount: 1,
    faceCount: 1,
    criticalErrorCount: 0,
    families: [{
      collection: mocks.family.collection,
      family: mocks.family.family,
      slug: mocks.family.slug,
      source: { url: mocks.family.sourceUrl, commit: mocks.family.sourceVersion },
      licenses: [{ file: mocks.family.licenseFile, spdx: mocks.family.licenseId, sha256: mocks.family.licenseSha256, byteLength: mocks.family.licenseByteLength }],
      faces: [{
        file: mocks.face.file,
        collectionIndex: mocks.face.collectionIndex,
        sha256: mocks.face.sha256,
        byteLength: mocks.face.byteLength,
        family: mocks.face.family,
        subfamily: mocks.face.subfamily,
        fullName: mocks.face.fullName,
        postscriptName: mocks.face.postscriptName,
        version: mocks.face.version,
        weight: mocks.face.weight,
        style: mocks.face.style,
        stretchPercent: mocks.face.stretchPercent,
        glyphCount: mocks.face.glyphCount,
        variable: mocks.face.variable,
        axes: [],
        hasVerticalSubstitution: mocks.face.hasVerticalSubstitution,
      }],
      warnings: [],
    }],
  };
}

async function selectPaperFace(host: HTMLElement): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button[aria-expanded]')).not.toBeNull());
  });
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    await act(async () => toggle.click());
  }
  await act(async () => {
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button[aria-label="Liberation Sans, Regular"]')).not.toBeNull());
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Liberation Sans, Regular"]')?.click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('inventory/font-inventory.json')) {
      return new Response(JSON.stringify(inventoryResponse()), { status: 200 });
    }
    return new Response(testFontBytes);
  }));
  vi.stubGlobal('FontFace', class { async load() { return this; } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } });
});

afterEach(() => {
  delete window.signalLoomNative;
  mocks.addImportedFont.mockReset();
  mocks.installBundledPaperFontFace.mockReset();
  vi.unstubAllGlobals();
});

describe('PaperBundledFontPicker selection authority (FBL-025)', () => {
  it('does not publish a delayed Paper install after unmount and remount on the same bridge', async () => {
    window.signalLoomNative = bridge() as never;
    let resolveInstall: ((value: unknown) => void) | undefined;
    mocks.installBundledPaperFontFace.mockImplementation(() => new Promise((resolve) => { resolveInstall = resolve; }));
    const staleOnChange = vi.fn();
    const host = document.createElement('div');
    const firstRoot = createRoot(host);

    await act(async () => firstRoot.render(<PaperBundledFontPicker onChange={staleOnChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    await selectPaperFace(host);
    await act(async () => {
      await vi.waitFor(() => expect(mocks.installBundledPaperFontFace).toHaveBeenCalledTimes(1));
    });
    await act(async () => firstRoot.unmount());

    const remountedOnChange = vi.fn();
    const remountedRoot = createRoot(host);
    await act(async () => remountedRoot.render(<PaperBundledFontPicker onChange={remountedOnChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    await act(async () => resolveInstall?.({ id: 'installed-stale-face' }));

    expect(mocks.addImportedFont).not.toHaveBeenCalled();
    expect(staleOnChange).not.toHaveBeenCalled();
    expect(remountedOnChange).not.toHaveBeenCalled();
    await act(async () => remountedRoot.unmount());
  });

  it('does not mutate Paper typography or document state after its installation await loses bridge authority', async () => {
    const aBridge = bridge();
    window.signalLoomNative = aBridge as never;
    let resolveInstall: ((value: unknown) => void) | undefined;
    mocks.installBundledPaperFontFace.mockImplementation(() => new Promise((resolve) => { resolveInstall = resolve; }));
    const onChange = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<PaperBundledFontPicker onChange={onChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    await selectPaperFace(host);
    await act(async () => {
      await vi.waitFor(() => expect(mocks.installBundledPaperFontFace).toHaveBeenCalledTimes(1));
    });

    // This is a replacement of the live bridge identity, not an unmount of the Paper picker.
    window.signalLoomNative = bridge() as never;
    await act(async () => root.render(<PaperBundledFontPicker onChange={onChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    expect(getSignalLoomNativeBridge()).not.toBe(aBridge);
    await act(async () => resolveInstall?.({ id: 'installed-a-face' }));

    expect(mocks.addImportedFont).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('pinned to this document');
    await act(async () => root.unmount());
  });

  it('publishes a current Paper selection after installation completes', async () => {
    window.signalLoomNative = bridge() as never;
    mocks.installBundledPaperFontFace.mockResolvedValue({ id: 'installed-current-face' });
    const onChange = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<PaperBundledFontPicker onChange={onChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    await selectPaperFace(host);
    await act(async () => {
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        fontFamily: 'Liberation Sans',
        fontWeight: '400',
      }), expect.any(Object), { id: 'installed-current-face' }));
    });

    expect(mocks.addImportedFont).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Liberation Sans Regular pinned to this document');
    await act(async () => root.unmount());
  });

  it('allows a second current Paper selection after clearing its prior notice', async () => {
    window.signalLoomNative = bridge() as never;
    mocks.installBundledPaperFontFace
      .mockResolvedValueOnce({ id: 'installed-first-face' })
      .mockResolvedValueOnce({ id: 'installed-second-face' });
    const onChange = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<PaperBundledFontPicker onChange={onChange} typography={DEFAULT_PAPER_TYPOGRAPHY} />));
    await selectPaperFace(host);
    await act(async () => {
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    });
    expect(host.textContent).toContain('Liberation Sans Regular pinned to this document');

    await selectPaperFace(host);
    await act(async () => {
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    });
    expect(mocks.addImportedFont).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
