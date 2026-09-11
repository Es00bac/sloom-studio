import { describe, expect, it } from 'vitest';

interface ViteConfigLike {
  base?: string;
}

async function loadViteConfig(): Promise<ViteConfigLike> {
  const module = await import('../../vite.config');

  return module.default as ViteConfigLike;
}

describe('Vite build configuration', () => {
  it('emits relative asset paths so the same build works from Electron file URLs', async () => {
    const config = await loadViteConfig();

    expect(config.base).toBe('./');
  });
});
