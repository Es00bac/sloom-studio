// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginHaneQrPairing,
  isHaneQrPairingAvailable,
  pollHaneQrPairing,
} from './haneQrPairing';

afterEach(() => {
  delete window.signalLoomNative;
  vi.restoreAllMocks();
});

describe('portable Hane QR pairing bridge', () => {
  it('normalizes Electron invitations and returns only the main-custodied completion marker', async () => {
    const invitationId = '0123456789abcdef0123456789abcdef';
    window.signalLoomNative = {
      beginHaneQrPairing: vi.fn(async () => ({
        ok: true,
        invitationId,
        payload: 'sloom-link://pair?v=1',
        expiresAt: Date.now() + 120_000,
        deviceLabel: 'Sloom Studio on linux',
      })),
      pollHaneQrPairing: vi.fn(async () => ({
        status: 'completed' as const,
        hostBaseUrl: 'http://192.168.1.42:8723',
        proxyApiBase: 'signal-loom-phone://host/__loom/api',
        generation: 8,
        haneDeviceLabel: 'Samsung Note9',
        tokenCustodied: true,
      })),
      cancelHaneQrPairing: vi.fn(async () => ({ ok: true })),
    } as never;

    expect(isHaneQrPairingAvailable()).toBe(true);
    await expect(beginHaneQrPairing()).resolves.toMatchObject({
      invitationId,
      deviceLabel: 'Sloom Studio on linux',
    });
    const completion = await pollHaneQrPairing(invitationId);
    expect(completion).toEqual({
      status: 'completed',
      runtime: 'electron',
      hostBaseUrl: 'http://192.168.1.42:8723',
      proxyApiBase: 'signal-loom-phone://host/__loom/api',
      generation: 8,
      haneDeviceLabel: 'Samsung Note9',
    });
    expect(completion).not.toHaveProperty('token');
  });

  it('rejects malformed invitation data at the renderer boundary', async () => {
    window.signalLoomNative = {
      beginHaneQrPairing: vi.fn(async () => ({
        ok: true,
        invitationId: 'not-an-id',
        payload: 'https://example.com/',
        expiresAt: Date.now() + 120_000,
        deviceLabel: 'Sloom Studio',
      })),
      pollHaneQrPairing: vi.fn(),
      cancelHaneQrPairing: vi.fn(),
    } as never;

    await expect(beginHaneQrPairing()).rejects.toThrow(/valid Hane pairing invitation/i);
  });
});
