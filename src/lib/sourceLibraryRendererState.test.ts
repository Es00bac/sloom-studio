import { describe, expect, it } from 'vitest';
import { buildSourceLibraryRendererItemIds } from './sourceLibraryRendererState';

describe('sourceLibraryRendererState', () => {
  it('serializes source-library item ids for native renderer convergence checks', () => {
    expect(buildSourceLibraryRendererItemIds([
      { id: 'panel-1' },
      { id: 'panel with spaces' },
      { id: '' },
      { id: 'panel-2' },
    ])).toBe('panel-1 panel%20with%20spaces panel-2');
  });
});
