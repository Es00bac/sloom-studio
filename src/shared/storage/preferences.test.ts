import { describe, expect, it, vi } from 'vitest';
import {
  readStringPreference,
  writeStringPreference,
  type PreferenceStorage,
} from './preferences';

describe('shared storage preferences', () => {
  it('returns the fallback when storage is unavailable or unreadable', () => {
    expect(readStringPreference({ key: 'missing', fallback: 'fallback', storage: undefined })).toBe('fallback');
    expect(readStringPreference({
      key: 'bad',
      fallback: 'fallback',
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    })).toBe('fallback');
  });

  it('normalizes values read from storage', () => {
    const storage = memoryStorage({ format: 'image/xcf' });

    expect(readStringPreference({
      key: 'format',
      fallback: 'image/png',
      normalize: (value) => value === 'image/xcf' ? value : 'image/png',
      storage,
    })).toBe('image/xcf');
  });

  it('normalizes values before writing and ignores storage write failures', () => {
    const storage = memoryStorage();

    writeStringPreference({
      key: 'format',
      value: 'bad',
      fallback: 'image/png',
      normalize: (value) => value === 'image/xcf' ? value : 'image/png',
      storage,
    });

    expect(storage.getItem('format')).toBe('image/png');

    expect(() => writeStringPreference({
      key: 'format',
      value: 'image/xcf',
      fallback: 'image/png',
      storage: {
        getItem: vi.fn(),
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: vi.fn(),
      },
    })).not.toThrow();
  });
});

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
