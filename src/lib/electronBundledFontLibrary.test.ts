import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ElectronBundledFontLibraryModule {
  resolveBundledFontLibraryRoot(options: {
    appIsPackaged: boolean;
    resourcesPath: string;
    appRoot: string;
    env?: Record<string, string | undefined>;
  }): string | undefined;
  resolveBundledFontResourcePath(root: string, requestUrl: string): string | undefined;
}

async function loadModule(): Promise<ElectronBundledFontLibraryModule> {
  // @ts-expect-error Electron's boundary helper is deliberately authored as CommonJS for main-process startup.
  return await import('../../electron/bundled-font-library.cjs') as ElectronBundledFontLibraryModule;
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sloom-font-library-'));
  mkdirSync(join(root, 'inventory'), { recursive: true });
  mkdirSync(join(root, 'collection', 'base', 'demo'), { recursive: true });
  writeFileSync(join(root, 'inventory', 'font-inventory.json'), '{}');
  writeFileSync(join(root, 'collection', 'base', 'demo', 'Demo.ttf'), 'font');
  return realpathSync(root);
}

describe('Electron bundled font library boundary', () => {
  it('prefers the packaged font resource and supports an explicit development pack root', async () => {
    const module = await loadModule();
    const packaged = fixtureRoot();
    const resourcesPath = resolve(packaged, '..');
    const packagedTarget = join(resourcesPath, 'font-library');
    mkdirSync(packagedTarget, { recursive: true });
    mkdirSync(join(packagedTarget, 'inventory'), { recursive: true });
    writeFileSync(join(packagedTarget, 'inventory', 'font-inventory.json'), '{}');

    expect(module.resolveBundledFontLibraryRoot({
      appIsPackaged: true,
      resourcesPath,
      appRoot: '/unused',
    })).toBe(realpathSync(packagedTarget));
    expect(module.resolveBundledFontLibraryRoot({
      appIsPackaged: false,
      resourcesPath: '/unused',
      appRoot: '/unused',
      env: { SLOOM_FONT_PACK_DIR: packaged },
    })).toBe(packaged);
  });

  it('serves only files inside the verified root', async () => {
    const module = await loadModule();
    const root = fixtureRoot();

    expect(module.resolveBundledFontResourcePath(
      root,
      'signal-loom-font://library/collection/base/demo/Demo.ttf',
    )).toBe(join(root, 'collection', 'base', 'demo', 'Demo.ttf'));
    expect(module.resolveBundledFontResourcePath(root, 'signal-loom-font://other/collection/base/demo/Demo.ttf')).toBeUndefined();
    expect(module.resolveBundledFontResourcePath(root, 'signal-loom-font://library/%2e%2e/outside.ttf')).toBeUndefined();
  });
});
