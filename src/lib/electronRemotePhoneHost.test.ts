import { describe, expect, it } from 'vitest';

interface RemotePhoneHostModule {
  REMOTE_PHONE_PROXY_ORIGIN: string;
  buildRemotePhoneHostTarget: (baseUrl: string, requestUrl: string) => string;
  filterRemotePhoneRequestHeaders: (headers: HeadersInit) => Record<string, string>;
  normalizeRemotePhoneHostBaseUrl: (value: string) => string;
  normalizeRemotePhoneMethod: (value: string) => string;
}

async function loadModule(): Promise<RemotePhoneHostModule> {
  // @ts-expect-error Electron's boundary helper is deliberately authored as CommonJS.
  return await import('../../electron/remote-phone-host.cjs') as RemotePhoneHostModule;
}

describe('Electron remote phone-host boundary', () => {
  it('accepts only canonical private/loopback Hane Link origins', async () => {
    const boundary = await loadModule();
    expect(boundary.normalizeRemotePhoneHostBaseUrl('192.168.1.42')).toBe('http://192.168.1.42:8723');
    expect(boundary.normalizeRemotePhoneHostBaseUrl('http://10.0.0.8:8723/')).toBe('http://10.0.0.8:8723');
    expect(boundary.normalizeRemotePhoneHostBaseUrl('http://10.0.0.8:8740/')).toBe('http://10.0.0.8:8740');
    expect(boundary.normalizeRemotePhoneHostBaseUrl('http://localhost')).toBe('http://localhost:8723');
    expect(() => boundary.normalizeRemotePhoneHostBaseUrl('https://192.168.1.42:8723')).toThrow(/http/);
    expect(() => boundary.normalizeRemotePhoneHostBaseUrl('http://8.8.8.8:8723')).toThrow(/private/);
    expect(() => boundary.normalizeRemotePhoneHostBaseUrl('http://192.168.1.42:9999')).toThrow(/Hane Link-assigned/);
    expect(() => boundary.normalizeRemotePhoneHostBaseUrl('http://user@192.168.1.42:8723')).toThrow(/credentials/);
    expect(() => boundary.normalizeRemotePhoneHostBaseUrl('http://192.168.1.42:8723/api')).toThrow(/without an API path/);
  });

  it('maps only the fixed application API scheme without traversal or arbitrary origins', async () => {
    const boundary = await loadModule();
    expect(boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      `${boundary.REMOTE_PHONE_PROXY_ORIGIN}/__loom/api/project/video/events?since=4`,
    )).toBe('http://192.168.1.42:8723/__loom/api/project/video/events?since=4');
    expect(() => boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      'signal-loom-phone://evil/__loom/api/health',
    )).toThrow(/fixed application origin/);
    expect(() => boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      'signal-loom-phone://host/private-file',
    )).toThrow(/API namespace/);
    expect(() => boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      'signal-loom-phone://host/__loom/api/%2e%2e/private-file',
    )).toThrow(/traversal/);
    expect(() => boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      'signal-loom-phone://host/__loom/api/project%2f..%2fprivate-file',
    )).toThrow(/traversal/);
    expect(() => boundary.buildRemotePhoneHostTarget(
      'http://192.168.1.42:8723',
      'signal-loom-phone://host/__loom/api/project%5c..%5cprivate-file',
    )).toThrow(/traversal/);
  });

  it('allows only the streaming API methods and narrow request headers', async () => {
    const boundary = await loadModule();
    expect(boundary.normalizeRemotePhoneMethod('put')).toBe('PUT');
    expect(() => boundary.normalizeRemotePhoneMethod('DELETE')).toThrow(/not allowed/);
    expect(boundary.filterRemotePhoneRequestHeaders({
      Accept: 'application/json',
      Authorization: 'Bearer secret',
      Range: 'bytes=0-1023',
      Cookie: 'do-not-forward',
      Origin: 'https://attacker.invalid',
    })).toEqual({
      accept: 'application/json',
      range: 'bytes=0-1023',
    });
  });
});
