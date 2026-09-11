import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('provider-pack native broker boundary', () => {
  it('exposes only a bounded request and cancellation surface through context isolation', () => {
    const preload = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');
    const nativeTypes = readFileSync(join(process.cwd(), 'src/lib/nativeApp.ts'), 'utf8');

    expect(preload).toContain("providerPackRequest: (request) => ipcRenderer.invoke('signal-loom:provider-pack-request', request)");
    expect(preload).toContain("cancelProviderPackRequest: (cancellationId) => ipcRenderer.invoke('signal-loom:provider-pack-request-cancel', cancellationId)");
    expect(nativeTypes).toContain("kind: 'text' | 'binary' | 'multipart'");
    expect(nativeTypes).not.toMatch(/providerPackRequest[^]*javascript/i);
  });

  it('requires an exact approved origin, rejects credential URLs and authenticated redirects, and caps bytes', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main.mjs'), 'utf8');
    const handler = source.match(
      /ipcMain\.handle\('signal-loom:provider-pack-request'[\s\S]*?ipcMain\.handle\('signal-loom:provider-pack-request-cancel'/,
    )?.[0] ?? '';

    expect(handler).toContain('url.origin !== approvedOrigin');
    expect(handler).toContain('url.username');
    expect(handler).toContain('url.password');
    expect(handler).toContain("url.protocol !== 'https:'");
    expect(handler).toContain('isPrivateProviderPackHost(url.hostname)');
    expect(handler).toContain("redirect: 'error'");
    expect(handler).toContain("['host', 'origin', 'referer', 'cookie', 'set-cookie', 'proxy-authorization']");
    expect(handler).toContain('bytes.length > 50 * 1024 * 1024');
    expect(source).toMatch(/signal-loom:provider-pack-request-cancel[\s\S]*controller\.abort\(\)/);
  });

  it('serializes only declarative text, binary, and bounded multipart bodies', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main.mjs'), 'utf8');
    const bodyBuilder = source.match(/function materializeProviderPackBrokerBody\(body\)[\s\S]*?\n}/)?.[0] ?? '';

    expect(bodyBuilder).toContain("body.kind === 'text'");
    expect(bodyBuilder).toContain("body.kind === 'binary'");
    expect(bodyBuilder).toContain("body.kind === 'multipart'");
    expect(bodyBuilder).toContain('body.parts.slice(0, 1_024)');
    expect(bodyBuilder).toContain('50 * 1024 * 1024');
    expect(bodyBuilder).not.toMatch(/eval|Function\(/);
  });
});
