import { describe, expect, it } from 'vitest';
import { normalizeImportedMediaBatch } from './flowImportWorker';

describe('normalizeImportedMediaBatch', () => {
  it('returns normalized metadata without touching renderer-only APIs', async () => {
    const result = await normalizeImportedMediaBatch([
      { filePath: '/tmp/panel.png', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    ]);

    expect(result[0]).toMatchObject({
      filePath: '/tmp/panel.png',
      label: 'panel.png',
      kind: 'image',
      mimeType: 'image/png',
    });
  });
});
