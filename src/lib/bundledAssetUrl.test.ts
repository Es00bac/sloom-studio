// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBundledAssetUrl } from './bundledAssetUrl';

/** Run `fn` with `document.baseURI` stubbed to `baseUri`, restoring the real getter afterward. */
function withBaseUri<T>(baseUri: string, fn: () => T): T {
  const spy = vi.spyOn(document, 'baseURI', 'get').mockReturnValue(baseUri);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

describe('resolveBundledAssetUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves a root-absolute bundled path against a served http origin', () => {
    withBaseUri('http://localhost:5173/', () => {
      expect(resolveBundledAssetUrl('/lcms.wasm')).toBe('http://localhost:5173/lcms.wasm');
      expect(resolveBundledAssetUrl('/icc/FOGRA39L_coated.icc')).toBe(
        'http://localhost:5173/icc/FOGRA39L_coated.icc',
      );
    });
  });

  it('resolves against the packaged file:// document base (the bug this fixes)', () => {
    // Packaged Electron loads dist/index.html over a bare file:// URL. A root-absolute `/lcms.wasm`
    // would 404 at the filesystem root; resolving against the base lands it next to index.html.
    withBaseUri('file:///opt/signal-loom/resources/app/dist/index.html', () => {
      expect(resolveBundledAssetUrl('/lcms.wasm')).toBe(
        'file:///opt/signal-loom/resources/app/dist/lcms.wasm',
      );
      expect(resolveBundledAssetUrl('/icc/FOGRA39L_coated.icc')).toBe(
        'file:///opt/signal-loom/resources/app/dist/icc/FOGRA39L_coated.icc',
      );
    });
  });

  it('resolves the bare filename the emscripten glue requests', () => {
    withBaseUri('file:///opt/app/dist/index.html', () => {
      expect(resolveBundledAssetUrl('lcms.wasm')).toBe('file:///opt/app/dist/lcms.wasm');
    });
  });

  it('honors a non-root served base path', () => {
    withBaseUri('https://host.example/app/', () => {
      expect(resolveBundledAssetUrl('/icc/x.icc')).toBe('https://host.example/app/icc/x.icc');
    });
  });

  it('passes absolute URLs through untouched', () => {
    for (const url of [
      'https://cdn.example/lcms.wasm',
      'file:///already/absolute.icc',
      'data:application/octet-stream;base64,AAAA',
      'blob:https://host/abc',
      'capacitor://localhost/icc.icc',
    ]) {
      expect(resolveBundledAssetUrl(url)).toBe(url);
    }
  });
});
