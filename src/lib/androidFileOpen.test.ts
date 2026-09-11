import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameFromUri, readOpenedUriBytes, registerAndroidFileOpenHandler } from './androidFileOpen';

const { appMocks, shareIntentMocks } = vi.hoisted(() => ({
  appMocks: {
    getLaunchUrl: vi.fn(),
    addListener: vi.fn(),
  },
  shareIntentMocks: {
    getLaunchShareIntent: vi.fn(),
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (uri: string) => `https://localhost/_capacitor_content_/${encodeURIComponent(uri)}`,
    isNativePlatform: () => true,
  },
  registerPlugin: vi.fn(() => shareIntentMocks),
}));
vi.mock('@capacitor/app', () => ({ App: appMocks }));

describe('fileNameFromUri', () => {
  it('reads a plain file:// name', () => {
    expect(fileNameFromUri('file:///storage/emulated/0/Download/Test1.slimg')).toBe('Test1.slimg');
  });

  it('decodes a document-provider content URI (colon + slash encoded)', () => {
    expect(
      fileNameFromUri(
        'content://com.android.providers.downloads.documents/document/primary%3ADownload%2FMy%20Zine.slppr',
      ),
    ).toBe('My Zine.slppr');
  });

  it('strips query and fragment', () => {
    expect(fileNameFromUri('content://x/y/Scene.sloom?take=1#frag')).toBe('Scene.sloom');
  });

  it('falls back to a generic name when no usable segment exists', () => {
    expect(fileNameFromUri('content://authority/123/')).toBe('opened-file');
  });
});

describe('readOpenedUriBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads bytes through the unpatched WebView fetch (not the CapacitorHttp-patched one)', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
    const webFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    vi.stubGlobal('CapacitorWebFetch', webFetch);
    vi.stubGlobal('fetch', vi.fn()); // patched fetch must NOT be used

    const out = await readOpenedUriBytes('content://x/Test.slimg');

    expect(webFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('throws a clear error when the proxy read fails', async () => {
    vi.stubGlobal('CapacitorWebFetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(readOpenedUriBytes('content://x/Bad.slimg')).rejects.toThrow('HTTP 404');
  });
});

describe('registerAndroidFileOpenHandler', () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

  let viewListenerCallback: ((event: { url: string }) => void) | undefined;
  let shareListenerCallback: ((event: { url: string; mimeType?: string }) => void) | undefined;
  let viewListenerRemove: ReturnType<typeof vi.fn>;
  let shareListenerRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('CapacitorWebFetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => PNG_BYTES.buffer }));

    viewListenerCallback = undefined;
    shareListenerCallback = undefined;
    viewListenerRemove = vi.fn();
    shareListenerRemove = vi.fn();

    appMocks.getLaunchUrl.mockReset().mockResolvedValue(undefined);
    appMocks.addListener.mockReset().mockImplementation((_event: string, cb: (event: { url: string }) => void) => {
      viewListenerCallback = cb;
      return Promise.resolve({ remove: viewListenerRemove });
    });

    shareIntentMocks.getLaunchShareIntent.mockReset().mockResolvedValue({});
    shareIntentMocks.addListener.mockReset().mockImplementation((_event: string, cb: (event: { url: string; mimeType?: string }) => void) => {
      shareListenerCallback = cb;
      return Promise.resolve({ remove: shareListenerRemove });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a file delivered via a cold-start ACTION_SEND share (getLaunchShareIntent)', async () => {
    shareIntentMocks.getLaunchShareIntent.mockResolvedValue({ url: 'content://media/external/images/42', mimeType: 'image/png' });
    const onOpen = vi.fn();

    registerAndroidFileOpenHandler(onOpen);

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), fileName: '42' });
  });

  it('opens a file delivered via a warm-start ACTION_SEND share (shareIntent event)', async () => {
    const onOpen = vi.fn();
    registerAndroidFileOpenHandler(onOpen);
    await vi.waitFor(() => expect(shareListenerCallback).toBeDefined());

    shareListenerCallback?.({ url: 'content://media/external/images/99', mimeType: 'image/jpeg' });

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), fileName: '99' });
  });

  it('still opens a file delivered via ACTION_VIEW (appUrlOpen) — unaffected by the ACTION_SEND addition', async () => {
    const onOpen = vi.fn();
    registerAndroidFileOpenHandler(onOpen);
    await vi.waitFor(() => expect(viewListenerCallback).toBeDefined());

    viewListenerCallback?.({ url: 'content://downloads/document/7' });

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), fileName: '7' });
  });

  it('ignores a shareIntent event with no content/file URI', async () => {
    const onOpen = vi.fn();
    registerAndroidFileOpenHandler(onOpen);
    await vi.waitFor(() => expect(shareListenerCallback).toBeDefined());

    // e.g. a text share (no stream) — the plugin wouldn't forward this, but guard defensively.
    shareListenerCallback?.({ url: '' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('removes both the ACTION_VIEW and ACTION_SEND listeners on cleanup', async () => {
    const cleanup = registerAndroidFileOpenHandler(vi.fn());
    await vi.waitFor(() => {
      expect(viewListenerCallback).toBeDefined();
      expect(shareListenerCallback).toBeDefined();
    });

    cleanup();
    await vi.waitFor(() => {
      expect(viewListenerRemove).toHaveBeenCalledTimes(1);
      expect(shareListenerRemove).toHaveBeenCalledTimes(1);
    });
  });
});
