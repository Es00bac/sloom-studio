import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  NativeInterfaceLocaleState,
  NativeInterfaceLocaleUpdateRequest,
  NativeInterfaceLocaleUpdateResult,
} from './nativeApp';

interface LocaleAuthority {
  getCurrent: () => NativeInterfaceLocaleState;
  update: (request: NativeInterfaceLocaleUpdateRequest) => NativeInterfaceLocaleUpdateResult;
}

interface LocaleAuthorityModule {
  createInterfaceLocaleAuthority: (options?: {
    initialLocale?: string;
    initialLocaleChosen?: boolean;
    onChange?: (state: NativeInterfaceLocaleState, change: { localeChanged: boolean }) => void;
  }) => LocaleAuthority;
}

async function loadAuthority(): Promise<LocaleAuthorityModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer module graph.
  return (await import('../../electron/interface-locale-authority.cjs')) as LocaleAuthorityModule;
}

describe('Electron process interface-locale authority', () => {
  it('has an explicit process owner and an English, unchosen revision-zero default', async () => {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const authority = createInterfaceLocaleAuthority();

    expect(authority.getCurrent()).toEqual({
      owner: 'electron-main',
      locale: 'en',
      localeChosen: false,
      revision: 0,
    });
  });

  it('accepts changes from either window while rejecting stale messages without rebuilding menus', async () => {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const publish = vi.fn();
    const authority = createInterfaceLocaleAuthority({ onChange: publish });

    const fromWindowA = authority.update({ locale: 'ja', localeChosen: true, expectedRevision: 0 });
    expect(fromWindowA).toMatchObject({ ok: true, changed: true, current: { locale: 'ja', revision: 1 } });
    expect(publish).toHaveBeenCalledTimes(1);

    const staleWindowB = authority.update({ locale: 'en', localeChosen: true, expectedRevision: 0 });
    expect(staleWindowB).toMatchObject({ ok: false, changed: false, rejected: 'stale-revision' });
    expect(staleWindowB.current).toMatchObject({ locale: 'ja', revision: 1 });
    expect(publish).toHaveBeenCalledTimes(1);

    const currentWindowB = authority.update({ locale: 'en', localeChosen: true, expectedRevision: 1 });
    expect(currentWindowB).toMatchObject({ ok: true, changed: true, current: { locale: 'en', revision: 2 } });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('treats delayed same-preference requests as idempotent and retains state after the writer closes', async () => {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const publish = vi.fn();
    const authority = createInterfaceLocaleAuthority({ onChange: publish });

    authority.update({ locale: 'ja', localeChosen: true, expectedRevision: 0 });
    // The initiating window is now gone. No release API exists because ownership is process-wide.
    expect(authority.getCurrent()).toMatchObject({ owner: 'electron-main', locale: 'ja', revision: 1 });

    const delayedDuplicate = authority.update({ locale: 'ja', localeChosen: true, expectedRevision: 0 });
    expect(delayedDuplicate).toMatchObject({ ok: true, changed: false, current: { locale: 'ja', revision: 1 } });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('broadcasts a same-language first-run choice without marking the menu tree changed', async () => {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const changes: Array<{ localeChanged: boolean }> = [];
    const authority = createInterfaceLocaleAuthority({
      onChange: (_state, change) => changes.push(change),
    });

    expect(authority.update({ locale: 'en', localeChosen: true, expectedRevision: 0 }))
      .toMatchObject({ ok: true, changed: true, current: { locale: 'en', localeChosen: true, revision: 1 } });
    expect(changes).toEqual([{ localeChanged: false }]);
  });

  it('fails closed on malformed locale requests', async () => {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const publish = vi.fn();
    const authority = createInterfaceLocaleAuthority({ onChange: publish });

    expect(authority.update({ locale: 'fr', localeChosen: true, expectedRevision: 0 } as never))
      .toMatchObject({ ok: false, changed: false, rejected: 'invalid-request' });
    expect(authority.update({ locale: 'ja', localeChosen: true, expectedRevision: -1 }))
      .toMatchObject({ ok: false, changed: false, rejected: 'invalid-request' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('wires native state, accepted-change publication, broadcasts, and menus to the one authority', () => {
    const main = readFileSync(join(process.cwd(), 'electron/main.mjs'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(main).toContain('const interfaceLocaleAuthority = createInterfaceLocaleAuthority');
    expect(main).toMatch(/function publishInterfaceLocaleChange\(state, change\)[\s\S]*if \(change\?\.localeChanged\)[\s\S]*installApplicationMenu\(\)[\s\S]*globalMenuController\?\.refresh\(\)[\s\S]*panelMenuService\?\.refresh\(\)[\s\S]*broadcastInterfaceLocaleChanged\(state\)/);
    expect(main).toMatch(/signal-loom:get-native-state[\s\S]*interfaceLocale: interfaceLocaleAuthority\.getCurrent\(\)/);
    expect(main).toMatch(/signal-loom:set-locale'[\s\S]*return interfaceLocaleAuthority\.update\(request\)/);
    expect(main).toMatch(/function menuForWorkspace[\s\S]*locale: interfaceLocaleAuthority\.getCurrent\(\)\.locale/);
    expect(main).not.toContain("appLocale = locale === 'ja'");
    expect(preload).toContain("onInterfaceLocaleChanged: (callback) => onChannel('signal-loom:interface-locale-changed', callback)");
    expect(app).toMatch(/if \(!settingsHydrated\) return;[\s\S]*createNativeLocaleSyncController\([\s\S]*subscribeLocalIntent: subscribeSettingsLocaleIntent/);
    expect(app).not.toContain('void bridge.setLocale(locale)');
  });
});
