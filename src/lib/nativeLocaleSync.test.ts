import { describe, expect, it } from 'vitest';
import type {
  NativeInterfaceLocaleState,
  NativeInterfaceLocaleUpdateRequest,
  NativeInterfaceLocaleUpdateResult,
} from './nativeApp';
import {
  createNativeLocaleSyncController,
  type RendererLocalePreference,
} from './nativeLocaleSync';

interface AuthorityModule {
  createInterfaceLocaleAuthority: (options: {
    onChange: (state: NativeInterfaceLocaleState, change: { localeChanged: boolean }) => void;
  }) => {
    getCurrent: () => NativeInterfaceLocaleState;
    update: (request: NativeInterfaceLocaleUpdateRequest) => NativeInterfaceLocaleUpdateResult;
  };
}

type HubAuthority = ReturnType<AuthorityModule['createInterfaceLocaleAuthority']>;

async function loadAuthority(): Promise<AuthorityModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer module graph.
  return (await import('../../electron/interface-locale-authority.cjs')) as AuthorityModule;
}

class LocaleHub {
  private listeners = new Map<string, Set<(state: NativeInterfaceLocaleState) => void>>();
  private queued: Array<{ id: string; state: NativeInterfaceLocaleState }> = [];
  private immediate = true;
  menuRebuilds = 0;
  broadcasts = 0;
  authority: HubAuthority;

  private constructor(authority: HubAuthority) {
    this.authority = authority;
  }

  static async create(): Promise<LocaleHub> {
    const { createInterfaceLocaleAuthority } = await loadAuthority();
    const holder: { current?: LocaleHub } = {};
    const authority = createInterfaceLocaleAuthority({
      onChange: (state, change) => {
        const hub = holder.current;
        if (!hub) return;
        hub.broadcasts += 1;
        if (change.localeChanged) hub.menuRebuilds += 1;
        for (const [id, callbacks] of hub.listeners) {
          for (const callback of callbacks) {
            if (hub.immediate) callback(state);
            else hub.queued.push({ id, state: { ...state } });
          }
        }
      },
    });
    const hub = new LocaleHub(authority);
    holder.current = hub;
    return hub;
  }

  setQueued(value: boolean): void {
    this.immediate = !value;
  }

  deliverFor(id: string, revision: number): void {
    const index = this.queued.findIndex((entry) => entry.id === id && entry.state.revision === revision);
    if (index < 0) throw new Error(`Missing queued locale event for ${id} revision ${revision}.`);
    const [entry] = this.queued.splice(index, 1);
    for (const callback of this.listeners.get(id) ?? []) callback(entry.state);
  }

  bridge(id: string) {
    return {
      getNativeState: async () => ({ interfaceLocale: this.authority.getCurrent() }),
      setLocale: async (request: NativeInterfaceLocaleUpdateRequest) => this.authority.update(request),
      onInterfaceLocaleChanged: (callback: (state: NativeInterfaceLocaleState) => void) => {
        const callbacks = this.listeners.get(id) ?? new Set();
        callbacks.add(callback);
        this.listeners.set(id, callbacks);
        return () => callbacks.delete(callback);
      },
    };
  }
}

function createWindow(hub: LocaleHub, id: string, initial: RendererLocalePreference) {
  let local = { ...initial };
  const intentListeners = new Set<(preference: RendererLocalePreference) => void>();
  const controller = createNativeLocaleSyncController({
    bridge: hub.bridge(id),
    getLocalPreference: () => ({ ...local }),
    applyAuthoritativePreference: (preference) => {
      local = { ...preference };
    },
    subscribeLocalIntent: (callback) => {
      intentListeners.add(callback);
      return () => intentListeners.delete(callback);
    },
  });
  return {
    controller,
    getLocal: () => ({ ...local }),
    choose: (preference: RendererLocalePreference) => {
      local = { ...preference };
      for (const callback of intentListeners) callback({ ...preference });
    },
  };
}

describe('native renderer locale convergence', () => {
  it('seeds revision zero only after hydration and makes a later-starting window adopt it', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'ja', localeChosen: true });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });

    await windowA.controller.start();
    await windowB.controller.start();

    expect(hub.authority.getCurrent()).toMatchObject({ owner: 'electron-main', locale: 'ja', localeChosen: true, revision: 1 });
    expect(windowA.getLocal()).toEqual({ locale: 'ja', localeChosen: true });
    expect(windowB.getLocal()).toEqual({ locale: 'ja', localeChosen: true });
    expect(hub.menuRebuilds).toBe(1);
  });

  it('keeps a newer broadcast that arrives before an older startup-state response', async () => {
    let local: RendererLocalePreference = { locale: 'en', localeChosen: false };
    let nativeListener = (_state: NativeInterfaceLocaleState) => {};
    let resolveStartup = (_value: { interfaceLocale: NativeInterfaceLocaleState }) => {};
    const startup = new Promise<{ interfaceLocale: NativeInterfaceLocaleState }>((resolve) => {
      resolveStartup = resolve;
    });
    const controller = createNativeLocaleSyncController({
      bridge: {
        getNativeState: () => startup,
        setLocale: async () => { throw new Error('No update expected.'); },
        onInterfaceLocaleChanged: (callback) => {
          nativeListener = callback;
          return () => {};
        },
      },
      getLocalPreference: () => ({ ...local }),
      applyAuthoritativePreference: (preference) => { local = { ...preference }; },
      subscribeLocalIntent: () => () => {},
    });

    const starting = controller.start();
    nativeListener({ owner: 'electron-main', locale: 'ja', localeChosen: true, revision: 2 });
    resolveStartup({
      interfaceLocale: { owner: 'electron-main', locale: 'en', localeChosen: true, revision: 1 },
    });
    await starting;

    expect(controller.getAuthority()).toMatchObject({ locale: 'ja', revision: 2 });
    expect(local).toEqual({ locale: 'ja', localeChosen: true });
  });

  it('converges two live windows for changes initiated in either direction', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'en', localeChosen: false });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.start(), windowB.controller.start()]);

    windowA.choose({ locale: 'ja', localeChosen: true });
    await Promise.all([windowA.controller.whenIdle(), windowB.controller.whenIdle()]);
    expect(windowA.getLocal()).toEqual({ locale: 'ja', localeChosen: true });
    expect(windowB.getLocal()).toEqual({ locale: 'ja', localeChosen: true });

    windowB.choose({ locale: 'en', localeChosen: true });
    await Promise.all([windowA.controller.whenIdle(), windowB.controller.whenIdle()]);
    expect(windowA.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(windowB.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(hub.authority.getCurrent()).toMatchObject({ locale: 'en', revision: 2 });
    expect(hub.menuRebuilds).toBe(2);
  });

  it('ignores out-of-order broadcasts and stale requests while keeping the latest authority', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'en', localeChosen: false });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.start(), windowB.controller.start()]);
    hub.setQueued(true);

    windowA.choose({ locale: 'ja', localeChosen: true });
    await windowA.controller.whenIdle();
    windowA.choose({ locale: 'en', localeChosen: true });
    await windowA.controller.whenIdle();

    hub.deliverFor('b', 2);
    hub.deliverFor('b', 1);
    expect(windowB.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(windowB.controller.getAuthority()).toMatchObject({ locale: 'en', revision: 2 });

    const stale = hub.authority.update({ locale: 'ja', localeChosen: true, expectedRevision: 0 });
    expect(stale).toMatchObject({ ok: false, rejected: 'stale-revision', current: { locale: 'en', revision: 2 } });
    expect(hub.menuRebuilds).toBe(2);
  });

  it('keeps process ownership after the initiating window closes and lets a new window adopt current state', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'en', localeChosen: false });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.start(), windowB.controller.start()]);

    windowA.choose({ locale: 'ja', localeChosen: true });
    await windowA.controller.whenIdle();
    windowA.controller.stop();
    expect(hub.authority.getCurrent()).toMatchObject({ owner: 'electron-main', locale: 'ja', revision: 1 });

    windowB.choose({ locale: 'en', localeChosen: true });
    await windowB.controller.whenIdle();
    const windowC = createWindow(hub, 'c', { locale: 'ja', localeChosen: false });
    await windowC.controller.start();

    expect(hub.authority.getCurrent()).toMatchObject({ locale: 'en', localeChosen: true, revision: 2 });
    expect(windowB.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(windowC.getLocal()).toEqual({ locale: 'en', localeChosen: true });
  });

  it('does not rebuild or rebroadcast for same-locale idempotent intents', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'en', localeChosen: false });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.start(), windowB.controller.start()]);

    windowA.choose({ locale: 'en', localeChosen: false });
    windowB.choose({ locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.whenIdle(), windowB.controller.whenIdle()]);

    expect(hub.authority.getCurrent()).toMatchObject({ locale: 'en', revision: 0 });
    expect(hub.menuRebuilds).toBe(0);
    expect(hub.broadcasts).toBe(0);
  });

  it('broadcasts same-language first-run confirmation without rebuilding identical menus', async () => {
    const hub = await LocaleHub.create();
    const windowA = createWindow(hub, 'a', { locale: 'en', localeChosen: false });
    const windowB = createWindow(hub, 'b', { locale: 'en', localeChosen: false });
    await Promise.all([windowA.controller.start(), windowB.controller.start()]);

    windowA.choose({ locale: 'en', localeChosen: true });
    await Promise.all([windowA.controller.whenIdle(), windowB.controller.whenIdle()]);

    expect(windowA.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(windowB.getLocal()).toEqual({ locale: 'en', localeChosen: true });
    expect(hub.authority.getCurrent()).toMatchObject({ locale: 'en', localeChosen: true, revision: 1 });
    expect(hub.broadcasts).toBe(1);
    expect(hub.menuRebuilds).toBe(0);
  });
});
