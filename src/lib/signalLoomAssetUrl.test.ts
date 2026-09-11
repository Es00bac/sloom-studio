import { describe, expect, it } from 'vitest';
import { isDirectlyLoadableAssetUrl, isSignalLoomAssetUrl, parseSignalLoomAssetId } from './signalLoomAssetUrl';

describe('signalLoomAssetUrl', () => {
  it('detects signal-loom-asset URLs', () => {
    expect(isSignalLoomAssetUrl('signal-loom-asset://asset/abc')).toBe(true);
    expect(isSignalLoomAssetUrl('signal-loom-asset://file/xyz')).toBe(true);
    expect(isSignalLoomAssetUrl('https://x/y.png')).toBe(false);
    expect(isSignalLoomAssetUrl(undefined)).toBe(false);
  });

  it('extracts the asset id from asset-id references', () => {
    expect(parseSignalLoomAssetId('signal-loom-asset://asset/20094f11-f467-43b8-94bc-18074705ced4'))
      .toBe('20094f11-f467-43b8-94bc-18074705ced4');
    expect(parseSignalLoomAssetId('signal-loom-asset://asset/legacy-item')).toBe('legacy-item');
    expect(parseSignalLoomAssetId('signal-loom-asset://asset/page%3Acover')).toBe('page:cover');
    expect(parseSignalLoomAssetId('signal-loom-asset://file/abc')).toBeNull();
    expect(parseSignalLoomAssetId('signal-loom-asset://asset/../secret')).toBeNull();
    expect(parseSignalLoomAssetId('signal-loom-asset://asset/%E0%A4%A')).toBeNull();
    expect(parseSignalLoomAssetId('https://localhost/_capacitor_file_/x.png')).toBeNull();
    expect(parseSignalLoomAssetId(null)).toBeNull();
  });

  it('classifies directly-loadable URLs (and excludes the Electron-only scheme)', () => {
    expect(isDirectlyLoadableAssetUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isDirectlyLoadableAssetUrl('blob:http://x/abc')).toBe(true);
    expect(isDirectlyLoadableAssetUrl('https://localhost/_capacitor_file_/data/x.png')).toBe(true);
    expect(isDirectlyLoadableAssetUrl('https://cdn/x.png')).toBe(true);
    // The Electron-only scheme is NOT directly loadable in a WebView/browser.
    expect(isDirectlyLoadableAssetUrl('signal-loom-asset://asset/abc')).toBe(false);
    expect(isDirectlyLoadableAssetUrl('')).toBe(false);
    expect(isDirectlyLoadableAssetUrl(undefined)).toBe(false);
  });
});
