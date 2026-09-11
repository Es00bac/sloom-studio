import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  HANE_QR_PAIRING_PROTOCOL,
  HANE_QR_PAIRING_VERSION,
  buildInvitationUri,
  normalizeHaneCompletion,
  startHaneQrPairingServer,
} = require('../../electron/hane-qr-pairing.cjs') as {
  HANE_QR_PAIRING_PROTOCOL: string;
  HANE_QR_PAIRING_VERSION: number;
  buildInvitationUri: (input: {
    invitationId: string;
    secret: string;
    expiresAt: number;
    deviceLabel: string;
    callbackUrls: string[];
  }) => string;
  normalizeHaneCompletion: (
    value: unknown,
    invitationId: string,
    secret: string,
  ) => { haneUrl: string; token: string; haneDeviceLabel: string } | null;
  startHaneQrPairingServer: (options: {
    addresses: string[];
    deviceLabel: string;
    portStart: number;
    portEnd: number;
  }) => Promise<{
    invitation: {
      invitationId: string;
      payload: string;
      expiresAt: number;
      deviceLabel: string;
    };
    poll: (invitationId: string) => {
      status: string;
      haneUrl?: string;
      token?: string;
      haneDeviceLabel?: string;
    };
    close: () => void;
  }>;
};

const sessions: Array<{ close: () => void }> = [];

afterEach(() => {
  sessions.splice(0).forEach((session) => session.close());
});

describe('Electron Hane QR pairing receiver', () => {
  it('encodes a short-lived Sloom invitation with every private callback candidate', () => {
    const payload = buildInvitationUri({
      invitationId: 'invite-1',
      secret: 'secret-1',
      expiresAt: 123_456,
      deviceLabel: 'Sloom Studio on Linux',
      callbackUrls: [
        'http://10.0.0.10:8731/__loom/api/hane-pair/complete/invite-1',
        'http://192.168.1.10:8731/__loom/api/hane-pair/complete/invite-1',
      ],
    });
    const parsed = new URL(payload);

    expect(parsed.protocol).toBe('sloom-link:');
    expect(parsed.hostname).toBe('pair');
    expect(parsed.searchParams.get('v')).toBe('1');
    expect(parsed.searchParams.get('id')).toBe('invite-1');
    expect(parsed.searchParams.get('secret')).toBe('secret-1');
    expect(parsed.searchParams.get('name')).toBe('Sloom Studio on Linux');
    expect(parsed.searchParams.getAll('callback')).toHaveLength(2);
  });

  it('accepts only the exact invitation proof and a bounded private Hane capability', () => {
    const token = 'a'.repeat(64);
    const valid = {
      protocol: HANE_QR_PAIRING_PROTOCOL,
      version: HANE_QR_PAIRING_VERSION,
      invitationId: 'invite-1',
      secret: 'secret-1',
      haneUrl: 'http://10.0.0.88:8723/',
      token,
      haneDeviceLabel: 'Galaxy Note9',
    };

    expect(normalizeHaneCompletion(valid, 'invite-1', 'secret-1')).toEqual({
      haneUrl: 'http://10.0.0.88:8723/',
      token,
      haneDeviceLabel: 'Galaxy Note9',
    });
    expect(normalizeHaneCompletion({
      ...valid,
      haneUrl: 'http://10.0.0.88:8740/',
    }, 'invite-1', 'secret-1')).toMatchObject({
      haneUrl: 'http://10.0.0.88:8740/',
    });
    expect(normalizeHaneCompletion({ ...valid, secret: 'wrong' }, 'invite-1', 'secret-1')).toBeNull();
    expect(normalizeHaneCompletion({ ...valid, haneUrl: 'https://example.com/' }, 'invite-1', 'secret-1')).toBeNull();
    expect(normalizeHaneCompletion({
      ...valid,
      haneUrl: 'http://10.0.0.88:8735/',
    }, 'invite-1', 'secret-1')).toBeNull();
    expect(normalizeHaneCompletion({ ...valid, token: 'short' }, 'invite-1', 'secret-1')).toBeNull();
  });

  it('completes once through the secret-gated callback and never exposes another result', async () => {
    const session = await startHaneQrPairingServer({
      addresses: ['192.168.50.10'],
      deviceLabel: 'Sloom test desktop',
      portStart: 18_731,
      portEnd: 18_739,
    });
    sessions.push(session);
    const invitation = new URL(session.invitation.payload);
    const advertised = new URL(invitation.searchParams.get('callback')!);
    advertised.hostname = '127.0.0.1';
    const completion = {
      protocol: HANE_QR_PAIRING_PROTOCOL,
      version: HANE_QR_PAIRING_VERSION,
      invitationId: session.invitation.invitationId,
      secret: invitation.searchParams.get('secret'),
      haneUrl: 'http://127.0.0.1:8723/',
      token: 'b'.repeat(64),
      haneDeviceLabel: 'Test Hane',
    };

    const accepted = await fetch(advertised, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completion),
    });
    expect(accepted.status).toBe(200);
    expect(session.poll(session.invitation.invitationId)).toMatchObject({
      status: 'completed',
      haneUrl: 'http://127.0.0.1:8723/',
      token: 'b'.repeat(64),
      haneDeviceLabel: 'Test Hane',
    });

    const reused = await fetch(advertised, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completion),
    });
    expect(reused.status).toBe(409);
  });
});
