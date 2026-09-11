import { Capacitor, registerPlugin } from '@capacitor/core';

export interface HaneQrInvitation {
  invitationId: string;
  payload: string;
  expiresAt: number;
  deviceLabel: string;
}

export type HaneQrPairingPoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'invalid'; error: string }
  | {
      status: 'completed';
      runtime: 'electron';
      hostBaseUrl: string;
      proxyApiBase: string;
      generation: number;
      haneDeviceLabel: string;
    }
  | {
      status: 'completed';
      runtime: 'android';
      haneUrl: string;
      token: string;
      haneDeviceLabel: string;
    };

interface AndroidHaneQrPairingPlugin {
  begin(): Promise<Partial<HaneQrInvitation>>;
  poll(request: { invitationId: string }): Promise<{
    status?: string;
    haneUrl?: string;
    token?: string;
    haneDeviceLabel?: string;
    error?: string;
  }>;
  cancel(request: { invitationId: string }): Promise<{ ok?: boolean }>;
}

const PLUGIN_CACHE_KEY = '__signalLoomHaneQrPairingPlugin';

function androidPlugin(): AndroidHaneQrPairingPlugin {
  const state = globalThis as typeof globalThis & {
    [PLUGIN_CACHE_KEY]?: AndroidHaneQrPairingPlugin;
  };
  state[PLUGIN_CACHE_KEY] ??= registerPlugin<AndroidHaneQrPairingPlugin>('SignalLoomHanePairing');
  return state[PLUGIN_CACHE_KEY];
}

function isAndroidRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function isHaneQrPairingAvailable(): boolean {
  if (typeof window !== 'undefined') {
    const bridge = window.signalLoomNative;
    if (
      typeof bridge?.beginHaneQrPairing === 'function'
      && typeof bridge.pollHaneQrPairing === 'function'
      && typeof bridge.cancelHaneQrPairing === 'function'
    ) {
      return true;
    }
  }
  return isAndroidRuntime();
}

function normalizeInvitation(value: Partial<HaneQrInvitation> | null | undefined): HaneQrInvitation {
  if (
    typeof value?.invitationId !== 'string'
    || !/^[a-f0-9]{32}$/.test(value.invitationId)
    || typeof value.payload !== 'string'
    || !value.payload.startsWith('sloom-link://pair?')
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) <= Date.now()
    || typeof value.deviceLabel !== 'string'
    || !value.deviceLabel.trim()
  ) {
    throw new Error('Sloom Studio could not create a valid Hane pairing invitation.');
  }
  return {
    invitationId: value.invitationId,
    payload: value.payload,
    expiresAt: Number(value.expiresAt),
    deviceLabel: value.deviceLabel.trim(),
  };
}

export async function beginHaneQrPairing(): Promise<HaneQrInvitation> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  if (bridge?.beginHaneQrPairing) {
    const value = await bridge.beginHaneQrPairing();
    if (!value.ok) throw new Error(value.error || 'Sloom Studio could not create a Hane pairing invitation.');
    return normalizeInvitation(value);
  }
  if (isAndroidRuntime()) {
    return normalizeInvitation(await androidPlugin().begin());
  }
  throw new Error('QR pairing is available in the installed Sloom Studio apps.');
}

export async function pollHaneQrPairing(invitationId: string): Promise<HaneQrPairingPoll> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  if (bridge?.pollHaneQrPairing) {
    const value = await bridge.pollHaneQrPairing({ invitationId });
    if (value.status === 'pending' || value.status === 'expired') return { status: value.status };
    if (
      value.status === 'completed'
      && value.tokenCustodied === true
      && typeof value.hostBaseUrl === 'string'
      && typeof value.proxyApiBase === 'string'
      && Number.isSafeInteger(value.generation)
    ) {
      return {
        status: 'completed',
        runtime: 'electron',
        hostBaseUrl: value.hostBaseUrl,
        proxyApiBase: value.proxyApiBase,
        generation: value.generation!,
        haneDeviceLabel: value.haneDeviceLabel?.trim() || 'Hane mobile device',
      };
    }
    return { status: 'invalid', error: value.error || 'That Hane pairing invitation is invalid.' };
  }
  if (isAndroidRuntime()) {
    const value = await androidPlugin().poll({ invitationId });
    if (value.status === 'pending' || value.status === 'expired') return { status: value.status };
    if (
      value.status === 'completed'
      && typeof value.haneUrl === 'string'
      && typeof value.token === 'string'
      && /^[a-f0-9]{64}$/.test(value.token)
    ) {
      return {
        status: 'completed',
        runtime: 'android',
        haneUrl: value.haneUrl,
        token: value.token,
        haneDeviceLabel: value.haneDeviceLabel?.trim() || 'Hane mobile device',
      };
    }
    return { status: 'invalid', error: value.error || 'That Hane pairing invitation is invalid.' };
  }
  return { status: 'invalid', error: 'QR pairing is unavailable in this build.' };
}

export async function cancelHaneQrPairing(invitationId: string): Promise<void> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  if (bridge?.cancelHaneQrPairing) {
    await bridge.cancelHaneQrPairing({ invitationId }).catch(() => undefined);
    return;
  }
  if (isAndroidRuntime()) {
    await androidPlugin().cancel({ invitationId }).catch(() => undefined);
  }
}
