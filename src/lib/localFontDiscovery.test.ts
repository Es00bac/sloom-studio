import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLocalFonts,
  isLocalFontDiscoverySupported,
  LOCAL_FONT_DISCOVERY_LIMIT,
  type QueryLocalFonts,
} from './localFontDiscovery';

describe('local font discovery', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { queryLocalFonts?: unknown }).queryLocalFonts;
  });

  it('fails closed when the browser API is absent', async () => {
    expect(isLocalFontDiscoverySupported()).toBe(false);
    await expect(discoverLocalFonts()).resolves.toEqual({ status: 'unsupported', fonts: [], truncated: false });
  });

  it('normalizes, sorts, deduplicates, and does not read font bytes', async () => {
    const blob = vi.fn();
    const query = vi.fn(async () => [
      { family: '  Zed  ', fullName: ' Zed Regular ', postscriptName: 'Zed-Regular', style: '' },
      { family: 'Alpha', fullName: 'Alpha Italic', postscriptName: 'Alpha-Italic', style: 'italic', blob },
      { family: 'Alpha', fullName: 'Alpha Italic', postscriptName: 'Alpha-Italic', style: 'italic', blob },
      { family: '', fullName: 'Ignored', postscriptName: 'ignored', style: 'normal' },
    ]) as unknown as QueryLocalFonts;

    await expect(discoverLocalFonts(query)).resolves.toEqual({
      status: 'success',
      fonts: [
        { family: 'Alpha', fullName: 'Alpha Italic', postscriptName: 'Alpha-Italic', style: 'italic' },
        { family: 'Zed', fullName: 'Zed Regular', postscriptName: 'Zed-Regular', style: 'normal' },
      ],
      truncated: false,
    });
    expect(blob).not.toHaveBeenCalled();
  });

  it('bounds a large catalogue after deduplication', async () => {
    const query = vi.fn(async () => Array.from({ length: LOCAL_FONT_DISCOVERY_LIMIT + 1 }, (_, index) => ({
      family: `Family ${String(index).padStart(4, '0')}`,
      fullName: `Family ${index} Regular`,
      postscriptName: `Family-${index}-Regular`,
      style: 'normal',
    }))) as unknown as QueryLocalFonts;

    const result = await discoverLocalFonts(query);
    expect(result.status).toBe('success');
    expect(result.fonts).toHaveLength(LOCAL_FONT_DISCOVERY_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it('reports permission denial without throwing', async () => {
    const reason = new Error('permission denied');
    reason.name = 'NotAllowedError';
    await expect(discoverLocalFonts(vi.fn(async () => { throw reason; }) as QueryLocalFonts)).resolves.toEqual({
      status: 'permission-denied',
      fonts: [],
      truncated: false,
    });
  });

  it('reports unexpected API failures without retaining data', async () => {
    await expect(discoverLocalFonts(vi.fn(async () => { throw new Error('browser failed'); }) as QueryLocalFonts)).resolves.toEqual({
      status: 'error',
      fonts: [],
      truncated: false,
    });
  });
});
