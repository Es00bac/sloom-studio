import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Bridge to the native SignalLoomSystemUi plugin, which toggles Android immersive
 * fullscreen (hiding/showing the status + navigation bars). The web Fullscreen API does
 * nothing inside a Capacitor WebView, so on Android the fullscreen toggle routes here.
 */
export interface SignalLoomSystemUiPlugin {
  setFullscreen(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  setInterceptVolumeKeys(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

const SIGNAL_LOOM_SYSTEM_UI_PLUGIN_KEY = '__signalLoomSystemUiPlugin';

function getSignalLoomSystemUiPlugin(): SignalLoomSystemUiPlugin {
  const globalState = globalThis as typeof globalThis & {
    [SIGNAL_LOOM_SYSTEM_UI_PLUGIN_KEY]?: SignalLoomSystemUiPlugin;
  };
  const cachedPlugin = globalState[SIGNAL_LOOM_SYSTEM_UI_PLUGIN_KEY];
  if (cachedPlugin) {
    return cachedPlugin;
  }
  const plugin = registerPlugin<SignalLoomSystemUiPlugin>('SignalLoomSystemUi');
  globalState[SIGNAL_LOOM_SYSTEM_UI_PLUGIN_KEY] = plugin;
  return plugin;
}

/** True when running as the native Android app, where immersive fullscreen is available. */
export function isAndroidNativeFullscreenAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Toggle Android immersive fullscreen. Returns the applied state. */
export async function setAndroidFullscreen(enabled: boolean): Promise<boolean> {
  const result = await getSignalLoomSystemUiPlugin().setFullscreen({ enabled });
  return Boolean(result?.enabled ?? enabled);
}

/** Intercept/block Android hardware volume keys. Returns the applied state. */
export async function setAndroidInterceptVolumeKeys(enabled: boolean): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  const result = await getSignalLoomSystemUiPlugin().setInterceptVolumeKeys({ enabled });
  return Boolean(result?.enabled ?? enabled);
}
