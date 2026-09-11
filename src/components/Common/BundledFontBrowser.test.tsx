// @vitest-environment jsdom

import { act } from 'react';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bundledFontFaceRuntimeFamilyName,
  bundledFontFaceVariationSettingsCss,
  createBundledFontFaceReference,
  ensureBundledFontFaceRegistered,
  type BundledFontCatalog,
} from '../../lib/bundledFontLibrary';
import { useSettingsStore } from '../../store/settingsStore';
import { BundledFontBrowser } from './BundledFontBrowser';

const testFontBytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
const testFontSha256 = 'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee';

const catalog: BundledFontCatalog = {
  schemaVersion: 1,
  familyCount: 2,
  faceCount: 2,
  families: [
    {
      id: 'base:editorial', family: 'Editorial Serif', slug: 'editorial', collection: 'base', role: 'serif',
      sourceUrl: 'https://example.test', sourceVersion: '1', licenseId: 'OFL-1.1', licenseFile: 'licenses/editorial.txt',
      licenseSha256: 'a'.repeat(64), licenseByteLength: 1, warnings: [],
      faces: [{ id: 'editorial:regular', file: 'collection/base/editorial/Regular.ttf', collectionIndex: 0, sha256: testFontSha256, byteLength: testFontBytes.byteLength, family: 'Editorial Serif', subfamily: 'Regular', fullName: 'Editorial Serif Regular', postscriptName: 'EditorialSerif-Regular', version: '1', weight: 400, style: 'normal', stretchPercent: 100, glyphCount: 100, variable: false, axes: {}, canSubset: true, hasVerticalSubstitution: false }],
    },
    {
      id: 'base:tokyo', family: 'Liberation Sans', slug: 'tokyo', collection: 'base', role: 'japanese',
      sourceUrl: 'https://example.test', sourceVersion: '1', licenseId: 'OFL-1.1', licenseFile: 'licenses/tokyo.txt',
      licenseSha256: 'c'.repeat(64), licenseByteLength: 1, warnings: [],
      faces: [{ id: 'tokyo:regular', file: 'collection/base/tokyo/Regular.ttf', collectionIndex: 0, sha256: testFontSha256, byteLength: testFontBytes.byteLength, family: 'Liberation Sans', subfamily: 'Tokyo Regular', fullName: 'Liberation Sans Tokyo Regular', postscriptName: 'LiberationSans-Regular', version: '1', weight: 400, style: 'normal', stretchPercent: 100, glyphCount: 1000, variable: false, axes: {}, canSubset: true, hasVerticalSubstitution: true }],
    },
  ],
};

function inventoryResponse(family: string) {
  return {
    schemaVersion: 1,
    catalogFamilyCount: 1,
    faceCount: 1,
    criticalErrorCount: 0,
    families: [{
      collection: 'base',
      family,
      slug: family.toLocaleLowerCase().replace(/[^a-z0-9]/g, ''),
      source: { url: 'https://example.test', commit: '1' },
      licenses: [{ file: 'licenses/library.txt', spdx: 'OFL-1.1', sha256: 'a'.repeat(64), byteLength: 1 }],
      faces: [{
        file: 'collection/base/library/Regular.ttf',
        collectionIndex: 0,
        sha256: testFontSha256,
        byteLength: testFontBytes.byteLength,
        family,
        subfamily: 'Regular',
        fullName: `${family} Regular`,
        postscriptName: `${family.replace(/\s/g, '')}-Regular`,
        version: '1',
        weight: 400,
        stretchPercent: 100,
        glyphCount: 100,
        variable: false,
        axes: [],
        hasVerticalSubstitution: false,
      }],
      warnings: [],
    }],
  };
}

function selectionCatalog(id: string): BundledFontCatalog {
  const next = structuredClone(catalog);
  next.families[1].faces[0].id = `tokyo:${id}`;
  return next;
}

function selectedFaceButton(host: HTMLElement): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('button[aria-label="Liberation Sans, Tokyo Regular"]')!;
}

function stubCompleteNativeBridge(): void {
  window.signalLoomNative = {
    getNativeState: vi.fn(),
    onMenuCommand: vi.fn(),
    bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
  } as never;
}

function stubNativeBridgeWithStatus(status: () => Promise<{ available: boolean }>): ReturnType<typeof vi.fn> {
  const bundledFontLibraryStatus = vi.fn(status);
  window.signalLoomNative = {
    getNativeState: vi.fn(),
    onMenuCommand: vi.fn(),
    bundledFontLibraryStatus,
  } as never;
  return bundledFontLibraryStatus;
}

/** Flushes the async main-process capability round trip the shared hook awaits on mount. */
async function waitForBrowserToggle(host: HTMLElement): Promise<HTMLButtonElement> {
  await act(async () => {
    await vi.waitFor(() => expect(host.querySelector('button[aria-expanded]')).not.toBeNull());
  });
  return host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
}

/** Flushes the same round trip when it's expected to resolve to "unavailable" (nothing appears). */
async function flushPendingCapabilityQuery(): Promise<void> {
  await act(async () => {
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  });
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(testFontBytes)));
  vi.stubGlobal('FontFace', class {
    async load() { return this; }
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } });
  // The Electron main process registers signal-loom-font:// alongside this same preload
  // bridge (electron/main.mjs installProtocolHandlers + electron/preload.cjs); these tests
  // exercise the complete-bridge (desktop) path by default. Platform-gate tests below stub
  // an absent/malformed bridge explicitly.
  stubCompleteNativeBridge();
});

afterEach(() => {
  delete window.signalLoomNative;
  vi.unstubAllGlobals();
});

describe('BundledFontBrowser', () => {
  it('searches, previews, and selects an exact bundled face', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<BundledFontBrowser catalog={catalog} onSelect={onSelect} value="Current Font" weight={400} style="normal" />));

    const toggle = await waitForBrowserToggle(host);
    await act(async () => toggle.click());
    const search = host.querySelector<HTMLInputElement>('input[role="searchbox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Tokyo');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(host.textContent).not.toContain('Editorial Serif');
    const tokyo = host.querySelector<HTMLButtonElement>('button[aria-label*="Tokyo Regular"]')!;
    await act(async () => {
      await vi.waitFor(() => expect(tokyo.querySelector('[data-font-ready="true"]')).not.toBeNull());
    });
    const specimen = tokyo.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:regular"]')!;
    const reference = createBundledFontFaceReference(catalog.families[1], catalog.families[1].faces[0]);
    expect(specimen.classList.contains('font-sans')).toBe(false);
    expect(specimen.style.fontFamily).toBe(`"${bundledFontFaceRuntimeFamilyName(reference)}"`);
    expect(specimen.style.fontWeight).toBe('400');
    expect(specimen.style.fontStyle).toBe('normal');
    expect(specimen.style.fontStretch).toBe('100%');
    expect(specimen.textContent).toBe('Ag あア');
    await act(async () => tokyo.click());

    await act(async () => {
      await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(
        catalog.families[1],
        catalog.families[1].faces[0],
        expect.objectContaining({ isCurrent: expect.any(Function) }),
      ));
    });
    await act(async () => root.unmount());
  });

  it('filters by publishing role and exposes collection/embedding context', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<BundledFontBrowser catalog={catalog} onSelect={vi.fn()} value="" weight={400} style="normal" />));
    const toggle = await waitForBrowserToggle(host);
    await act(async () => toggle.click());
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Font role"]')!;
    await act(async () => {
      select.value = 'serif';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(host.textContent).toContain('Editorial Serif');
    expect(host.textContent).not.toContain('Tokyo Gothic');
    expect(host.textContent).toMatch(/2 families.*2 faces/i);
    expect(host.textContent).toMatch(/Exact face.*PDF/i);
    await act(async () => root.unmount());
  });

  it('renders a variable specimen with the exact registered face identity and default coordinates', async () => {
    const variableCatalog = structuredClone(catalog);
    variableCatalog.familyCount = 1;
    variableCatalog.faceCount = 1;
    variableCatalog.families = [variableCatalog.families[1]];
    const face = variableCatalog.families[0].faces[0];
    face.id = 'tokyo:variable';
    face.variable = true;
    face.axes = {
      wdth: { min: 75, default: 100, max: 125 },
      wght: { min: 100, default: 400, max: 900 },
    };
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={variableCatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-font-ready="true"]')).not.toBeNull());
    });

    const specimen = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:variable"]')!;
    const reference = createBundledFontFaceReference(variableCatalog.families[0], face);
    expect(specimen.style.fontFamily).toBe(`"${bundledFontFaceRuntimeFamilyName(reference)}"`);
    expect(specimen.style.fontVariationSettings).toBe(bundledFontFaceVariationSettingsCss(reference));
    expect(specimen.style.fontVariationSettings).toBe('"wdth" 100, "wght" 400');
    expect(specimen.style.fontWeight).toBe('400');
    expect(specimen.style.fontStyle).toBe('normal');
    expect(specimen.style.fontStretch).toBe('100%');
    await act(async () => root.unmount());
  });

  it('revokes face A readiness while face B is unseen, delayed, failed, and then recovered', async () => {
    const faceACatalog = structuredClone(catalog);
    faceACatalog.familyCount = 1;
    faceACatalog.faceCount = 1;
    faceACatalog.families = [faceACatalog.families[1]];
    faceACatalog.families[0].faces[0].id = 'tokyo:specimen-transition-a';
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={faceACatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-font-ready="true"]')).not.toBeNull());
    });
    const faceA = faceACatalog.families[0].faces[0];
    const faceAAlias = `"${bundledFontFaceRuntimeFamilyName(createBundledFontFaceReference(faceACatalog.families[0], faceA))}"`;
    expect(host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-a"]')?.style.fontFamily).toBe(faceAAlias);

    let intersect: (() => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = () => callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
      observe() {}
    });
    let settleFaceBFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolveResponse) => { settleFaceBFetch = resolveResponse; })));
    const faceBCatalog = structuredClone(faceACatalog);
    const faceB = faceBCatalog.families[0].faces[0];
    faceB.id = 'tokyo:specimen-transition-b';

    await act(async () => root.render(
      <BundledFontBrowser catalog={faceBCatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    const unseenFaceB = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-b"]')!;
    expect(unseenFaceB.dataset.fontReady).toBe('false');
    expect(unseenFaceB.style.fontFamily).toBe('');
    expect(unseenFaceB.style.fontFamily).not.toBe(faceAAlias);

    await act(async () => intersect?.());
    const delayedFaceB = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-b"]')!;
    expect(delayedFaceB.dataset.fontReady).toBe('false');
    expect(delayedFaceB.style.fontFamily).toBe('');

    await act(async () => settleFaceBFetch?.(new Response(null, { status: 503 })));
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Exact specimen unavailable'));
    });
    const failedFaceB = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-b"]')!;
    expect(failedFaceB.dataset.fontReady).toBe('false');
    expect(failedFaceB.style.fontFamily).toBe('');
    expect(failedFaceB.style.fontFamily).not.toBe(faceAAlias);

    vi.stubGlobal('IntersectionObserver', undefined);
    const recoveryFetch = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', recoveryFetch);
    let resolveRecoveryFontFace: (() => void) | undefined;
    const recoveryFontFaceLoad = vi.fn(function recoveryLoad(this: object) {
      return new Promise<object>((resolveLoad) => { resolveRecoveryFontFace = () => resolveLoad(this); });
    });
    vi.stubGlobal('FontFace', class {
      load() { return recoveryFontFaceLoad.call(this); }
    });
    const recoveredCatalog = structuredClone(faceBCatalog);
    await act(async () => root.render(
      <BundledFontBrowser catalog={recoveredCatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    await vi.waitFor(() => expect(recoveryFontFaceLoad).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveRecoveryFontFace?.();
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    });
    await vi.waitFor(() => {
      const candidate = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-b"]');
      expect(candidate?.dataset.fontReady, `${candidate?.outerHTML}\nfetches=${recoveryFetch.mock.calls.length}`).toBe('true');
    });
    const recoveredFace = recoveredCatalog.families[0].faces[0];
    const faceBAlias = `"${bundledFontFaceRuntimeFamilyName(createBundledFontFaceReference(recoveredCatalog.families[0], recoveredFace))}"`;
    const recoveredSpecimen = host.querySelector<HTMLElement>('[data-bundled-font-specimen="tokyo:specimen-transition-b"]')!;
    expect(recoveredSpecimen.style.fontFamily).toBe(faceBAlias);
    expect(recoveredSpecimen.style.fontFamily).not.toBe(faceAAlias);
    expect(recoveredSpecimen.style.fontWeight).toBe('400');
    expect(recoveredSpecimen.style.fontStyle).toBe('normal');
    expect(recoveredSpecimen.style.fontStretch).toBe('100%');
    await act(async () => root.unmount());
  });

  it('localizes a non-Error selection failure instead of exposing static English fallback copy', async () => {
    useSettingsStore.setState({ locale: 'ja' });
    const failureCatalog = structuredClone(catalog);
    failureCatalog.familyCount = 1;
    failureCatalog.faceCount = 1;
    failureCatalog.families = [failureCatalog.families[1]];
    failureCatalog.families[0].faces[0].id = 'tokyo:non-error-selection';
    vi.stubGlobal('IntersectionObserver', class { disconnect() {} observe() {} });
    let rejectFontFaceLoad: ((reason: unknown) => void) | undefined;
    const fontFaceLoad = vi.fn(() => new Promise<object>((_resolveLoad, rejectLoad) => { rejectFontFaceLoad = rejectLoad; }));
    vi.stubGlobal('FontFace', class {
      load() { return fontFaceLoad(); }
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <BundledFontBrowser catalog={failureCatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    await waitForBrowserToggle(host);
    const faceButton = host.querySelector<HTMLButtonElement>('button[aria-label*="Tokyo Regular"]');
    expect(faceButton).not.toBeNull();
    expect(faceButton?.disabled).toBe(false);
    await act(async () => faceButton!.click());
    await vi.waitFor(() => expect(fontFaceLoad).toHaveBeenCalledTimes(1));
    await act(async () => {
      rejectFontFaceLoad?.('font load rejected');
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    });
    await vi.waitFor(() => expect(host.textContent, `fontFaceLoads=${fontFaceLoad.mock.calls.length}`).toContain('この書体を選択できません：選択エラーの診断情報が提供されませんでした。'));
    await act(async () => root.unmount());
  });

  it('renders Japanese dynamic, plural, tooltip, empty, and catalog-error states', async () => {
    useSettingsStore.setState({ locale: 'ja' });
    const singleCatalog = structuredClone(catalog);
    singleCatalog.familyCount = 1;
    singleCatalog.faceCount = 1;
    singleCatalog.families = [singleCatalog.families[1]];
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <BundledFontBrowser catalog={singleCatalog} initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    const toggle = await waitForBrowserToggle(host);

    expect(toggle.title).toBe('監査済みの同梱フォントライブラリを開く');
    expect(host.textContent).toContain('同梱フォントを参照');
    expect(host.textContent).toContain('1 ファミリー・1 書体');
    expect(host.textContent).toContain('オフライン・ライセンス監査済み');
    expect(host.textContent).toContain('正確な書体を選択します');
    expect(host.querySelector('input[aria-label="フォントを検索"]')?.getAttribute('placeholder')).toBe('ファミリー、書体…');
    expect(host.querySelector('select[aria-label="フォントの用途"]')).not.toBeNull();

    const search = host.querySelector<HTMLInputElement>('input[role="searchbox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '見つからない');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('一致するフォントファミリーがありません。');
    await act(async () => root.unmount());

    const errorHost = document.createElement('div');
    const errorRoot = createRoot(errorHost);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject('catalog lookup rejected')));
    await act(async () => errorRoot.render(
      <BundledFontBrowser initiallyOpen onSelect={vi.fn()} value="" weight={400} style="normal" />,
    ));
    await waitForBrowserToggle(errorHost);
    await act(async () => {
      await vi.waitFor(() => expect(errorHost.textContent).toContain('同梱フォントライブラリを利用できません：カタログの診断情報が提供されませんでした。'));
    });
    await act(async () => errorRoot.unmount());
  });
});

describe('BundledFontBrowser selection authority (FBL-025)', () => {
  it('does not publish a delayed selection after unmount and remount on the same bridge', async () => {
    const aCatalog = selectionCatalog('selection-unmount-a');
    const remountedCatalog = selectionCatalog('selection-unmount-remount');
    const stableBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = stableBridge as never;
    let resolveARegistration: (() => void) | undefined;
    vi.stubGlobal('FontFace', class {
      load() {
        return new Promise((resolve) => { resolveARegistration = () => resolve(this); });
      }
    });
    const staleOnSelect = vi.fn();
    const host = document.createElement('div');
    const firstRoot = createRoot(host);

    await act(async () => firstRoot.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={staleOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(resolveARegistration).toBeTypeOf('function'));
    });
    await act(async () => firstRoot.unmount());

    vi.stubGlobal('FontFace', class { async load() { return this; } });
    const remountedOnSelect = vi.fn();
    const remountedRoot = createRoot(host);
    await act(async () => remountedRoot.render(
      <BundledFontBrowser catalog={remountedCatalog} initiallyOpen onSelect={remountedOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => resolveARegistration?.());

    expect(staleOnSelect).not.toHaveBeenCalled();
    expect(remountedOnSelect).not.toHaveBeenCalled();
    await act(async () => remountedRoot.unmount());
  });

  it('does not publish a delayed selection after same-bridge catalog and callback replacement', async () => {
    const aCatalog = selectionCatalog('selection-input-a');
    const bCatalog = selectionCatalog('selection-input-b');
    const stableBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = stableBridge as never;
    let resolveARegistration: (() => void) | undefined;
    vi.stubGlobal('FontFace', class {
      load() {
        return new Promise((resolve) => { resolveARegistration = () => resolve(this); });
      }
    });
    const staleOnSelect = vi.fn();
    const replacementOnSelect = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={staleOnSelect} style="normal" value="A" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(resolveARegistration).toBeTypeOf('function'));
    });

    await act(async () => root.render(
      <BundledFontBrowser catalog={bCatalog} initiallyOpen onSelect={replacementOnSelect} style="italic" value="B" weight={700} />,
    ));
    await act(async () => resolveARegistration?.());

    expect(staleOnSelect).not.toHaveBeenCalled();
    expect(replacementOnSelect).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('does not revive delayed A callback, busy, or error authority after A to B to the same A bridge', async () => {
    const aCatalog = selectionCatalog('selection-return-a');
    const bCatalog = selectionCatalog('selection-return-b');
    const aBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    const bBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = aBridge as never;
    let resolveARegistration: (() => void) | undefined;
    vi.stubGlobal('FontFace', class {
      load() {
        return new Promise((resolve) => { resolveARegistration = () => resolve(this); });
      }
    });
    const staleOnSelect = vi.fn(() => { throw new Error('stale A callback rejected'); });
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={staleOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(resolveARegistration).toBeTypeOf('function'));
    });

    window.signalLoomNative = bBridge as never;
    await act(async () => root.render(
      <BundledFontBrowser catalog={bCatalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);

    window.signalLoomNative = aBridge as never;
    await act(async () => root.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    expect(selectedFaceButton(host).disabled).toBe(false);

    await act(async () => resolveARegistration?.());
    expect(staleOnSelect).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('stale A callback rejected');
    await act(async () => root.unmount());
  });

  it('does not publish a delayed A selection into B and leaves B busy until B completes', async () => {
    const aCatalog = selectionCatalog('selection-authority-a');
    const bCatalog = selectionCatalog('selection-authority-b');
    const aBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = aBridge as never;
    let resolveARegistration: (() => void) | undefined;
    vi.stubGlobal('FontFace', class {
      load() {
        return new Promise((resolve) => { resolveARegistration = () => resolve(this); });
      }
    });
    const aOnSelect = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={aOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(resolveARegistration).toBeTypeOf('function'));
    });

    const bBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = bBridge as never;
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    let resolveBSelection: (() => void) | undefined;
    const bOnSelect = vi.fn(() => new Promise<void>((resolve) => { resolveBSelection = resolve; }));
    await act(async () => root.render(
      <BundledFontBrowser catalog={bCatalog} initiallyOpen onSelect={bOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(bOnSelect).toHaveBeenCalledTimes(1));
    });
    expect(selectedFaceButton(host).disabled).toBe(true);

    await act(async () => resolveARegistration?.());
    expect(aOnSelect).not.toHaveBeenCalled();
    // A's finally must not clear B's independently active busy selection.
    expect(selectedFaceButton(host).disabled).toBe(true);

    await act(async () => resolveBSelection?.());
    await act(async () => {
      await vi.waitFor(() => expect(selectedFaceButton(host).disabled).toBe(false));
    });
    expect(bOnSelect).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('does not let a stale A registration rejection overwrite B selection error state', async () => {
    const aCatalog = selectionCatalog('selection-error-a');
    const bCatalog = selectionCatalog('selection-error-b');
    // Pre-register B's exact face so the B error below is isolated to its ordinary callback,
    // while A alone remains delayed at registration.
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    await ensureBundledFontFaceRegistered(bCatalog.families[1], bCatalog.families[1].faces[0]);
    const aBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = aBridge as never;
    let rejectARegistration: ((reason: Error) => void) | undefined;
    vi.stubGlobal('FontFace', class {
      load() {
        return new Promise((_, reject) => { rejectARegistration = reject; });
      }
    });
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={aCatalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(rejectARegistration).toBeTypeOf('function'));
    });

    const bBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = bBridge as never;
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    const bOnSelect = vi.fn(() => { throw new Error('B selection rejected'); });
    await act(async () => root.render(
      <BundledFontBrowser catalog={bCatalog} initiallyOpen onSelect={bOnSelect} style="normal" value="" weight={400} />,
    ));
    await waitForBrowserToggle(host);
    await act(async () => selectedFaceButton(host).click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('B selection rejected'));
    });

    await act(async () => rejectARegistration?.(new Error('A registration rejected')));
    expect(host.textContent).toContain('B selection rejected');
    expect(host.textContent).not.toContain('A registration rejected');
    await act(async () => root.unmount());
  });
});

describe('BundledFontBrowser platform capability gate (FBL-025)', () => {
  it('renders nothing actionable and issues zero signal-loom-font fetches without a native bridge', async () => {
    delete window.signalLoomNative;
    const fetchSpy = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));

    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('fails closed with an old complete generic bridge that lacks the dedicated transport', async () => {
    // Older Electron preload code can expose all former generic methods but cannot prove that
    // this main process has a usable signal-loom-font root.
    window.signalLoomNative = { getNativeState: vi.fn(), onMenuCommand: vi.fn() } as never;
    const fetchSpy = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await flushPendingCapabilityQuery();

    expect(host.querySelector('button')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('fails closed with a complete generic bridge whose dedicated transport reports no root', async () => {
    // This is the packaged-but-font-pack-missing state: the ordinary Electron bridge is complete,
    // but every signal-loom-font request would 404. It must not advertise or fetch the library.
    const status = stubNativeBridgeWithStatus(async () => ({ available: false }));
    const fetchSpy = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await flushPendingCapabilityQuery();

    expect(host.querySelector('button')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('renders nothing and fetches nothing while the dedicated capability query is pending', async () => {
    let resolveStatus: ((status: { available: boolean }) => void) | undefined;
    const status = stubNativeBridgeWithStatus(() => new Promise((resolve) => { resolveStatus = resolve; }));
    const fetchSpy = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await flushPendingCapabilityQuery();

    expect(host.querySelector('button')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);

    await act(async () => resolveStatus?.({ available: true }));
    expect(await waitForBrowserToggle(host)).not.toBeNull();
    await act(async () => root.unmount());
  });

  it('fails closed when the dedicated capability transport rejects', async () => {
    const status = stubNativeBridgeWithStatus(async () => { throw new Error('IPC disconnected'); });
    const fetchSpy = vi.fn(async () => new Response(testFontBytes));
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    await flushPendingCapabilityQuery();

    expect(host.querySelector('button')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('fails closed immediately on bridge replacement and re-queries after remount', async () => {
    const firstStatus = stubNativeBridgeWithStatus(async () => ({ available: true }));
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    expect(await waitForBrowserToggle(host)).not.toBeNull();
    expect(firstStatus).toHaveBeenCalledTimes(1);

    const replacementStatus = stubNativeBridgeWithStatus(async () => ({ available: false }));
    await act(async () => root.render(
      <BundledFontBrowser catalog={catalog} onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    // A rerender that sees a new bridge may not replay the old bridge's positive capability.
    expect(host.querySelector('button')).toBeNull();
    await flushPendingCapabilityQuery();
    expect(host.querySelector('button')).toBeNull();
    expect(replacementStatus).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());

    const remountStatus = stubNativeBridgeWithStatus(async () => ({ available: true }));
    const remountedRoot = createRoot(host);
    await act(async () => remountedRoot.render(
      <BundledFontBrowser catalog={catalog} onSelect={vi.fn()} style="normal" value="" weight={400} />,
    ));
    expect(await waitForBrowserToggle(host)).not.toBeNull();
    expect(remountStatus).toHaveBeenCalledTimes(1);
    await act(async () => remountedRoot.unmount());
  });

  it('loads the audited catalog over signal-loom-font:// with a complete Electron bridge', async () => {
    stubCompleteNativeBridge();
    const inventoryResponse = {
      schemaVersion: 1,
      catalogFamilyCount: 1,
      faceCount: 1,
      criticalErrorCount: 0,
      families: [{
        collection: 'base',
        family: 'Liberation Sans',
        slug: 'liberationsans',
        source: { url: 'https://example.test', commit: '1' },
        licenses: [{ file: 'licenses/liberationsans.txt', spdx: 'OFL-1.1', sha256: 'a'.repeat(64), byteLength: 1 }],
        faces: [{
          file: 'collection/base/liberationsans/Regular.ttf',
          collectionIndex: 0,
          sha256: testFontSha256,
          byteLength: testFontBytes.byteLength,
          family: 'Liberation Sans',
          subfamily: 'Regular',
          fullName: 'Liberation Sans Regular',
          postscriptName: 'LiberationSans-Regular',
          version: '1',
          weight: 400,
          stretchPercent: 100,
          glyphCount: 100,
          variable: false,
          axes: [],
          hasVerticalSubstitution: false,
        }],
        warnings: [],
      }],
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('signal-loom-font://library/inventory/font-inventory.json')) {
        return new Response(JSON.stringify(inventoryResponse), { status: 200 });
      }
      return new Response(testFontBytes);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onSelect = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<BundledFontBrowser onSelect={onSelect} value="" weight={400} style="normal" />));
    const toggle = await waitForBrowserToggle(host);
    await act(async () => toggle.click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Liberation Sans'));
    });

    expect(fetchSpy).toHaveBeenCalledWith('signal-loom-font://library/inventory/font-inventory.json', expect.any(Object));
    const face = host.querySelector<HTMLButtonElement>('button[aria-label*="Liberation Sans"]')!;
    await act(async () => face.click());
    await act(async () => {
      await vi.waitFor(() => expect(onSelect).toHaveBeenCalled());
    });

    await act(async () => root.unmount());
  });

  it('discards a settled A catalog and requires B\'s own positive status and catalog load', async () => {
    const firstBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = firstBridge as never;
    const firstFetch = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('/inventory/font-inventory.json')
        ? new Response(JSON.stringify(inventoryResponse('A Catalog')), { status: 200 })
        : new Response(testFontBytes)
    ));
    vi.stubGlobal('fetch', firstFetch);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<BundledFontBrowser initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('A Catalog'));
    });
    expect(firstFetch.mock.calls.filter(([input]) => String(input).includes('/inventory/font-inventory.json'))).toHaveLength(1);

    let resolveReplacementStatus: ((status: { available: boolean }) => void) | undefined;
    const replacementBridge = {
      getNativeState: vi.fn(),
      onMenuCommand: vi.fn(),
      bundledFontLibraryStatus: vi.fn(() => new Promise<{ available: boolean }>((resolve) => { resolveReplacementStatus = resolve; })),
    };
    const replacementFetch = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('/inventory/font-inventory.json')
        ? new Response(JSON.stringify(inventoryResponse('B Catalog')), { status: 200 })
        : new Response(testFontBytes)
    ));
    window.signalLoomNative = replacementBridge as never;
    vi.stubGlobal('fetch', replacementFetch);
    await act(async () => root.render(<BundledFontBrowser initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />));

    // The rendered B bridge cannot show A's settled catalog while B authorization is pending.
    expect(host.querySelector('button')).toBeNull();
    await act(async () => resolveReplacementStatus?.({ available: true }));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('B Catalog'));
    });
    expect(host.textContent).not.toContain('A Catalog');
    expect(replacementBridge.bundledFontLibraryStatus).toHaveBeenCalledTimes(1);
    expect(replacementFetch.mock.calls.filter(([input]) => String(input).includes('/inventory/font-inventory.json'))).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('does not let a stale A catalog completion overwrite B browser state', async () => {
    const firstBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = firstBridge as never;
    let resolveFirstCatalog: ((value: ReturnType<typeof inventoryResponse>) => void) | undefined;
    let catalogRequestCount = 0;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/inventory/font-inventory.json')) {
        return new Response(testFontBytes);
      }
      catalogRequestCount += 1;
      if (catalogRequestCount === 1) {
        return {
          ok: true,
          status: 200,
          json: () => new Promise<ReturnType<typeof inventoryResponse>>((resolve) => { resolveFirstCatalog = resolve; }),
        };
      }
      return new Response(JSON.stringify(inventoryResponse('B Catalog')), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => root.render(<BundledFontBrowser initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    });

    const replacementBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    window.signalLoomNative = replacementBridge as never;
    await act(async () => root.render(<BundledFontBrowser initiallyOpen onSelect={vi.fn()} style="normal" value="" weight={400} />));
    await waitForBrowserToggle(host);
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('B Catalog'));
    });

    await act(async () => resolveFirstCatalog?.(inventoryResponse('A Catalog')));
    expect(host.textContent).toContain('B Catalog');
    expect(host.textContent).not.toContain('A Catalog');
    expect(replacementBridge.bundledFontLibraryStatus).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes('/inventory/font-inventory.json'))).toHaveLength(2);
    await act(async () => root.unmount());
  });
});
