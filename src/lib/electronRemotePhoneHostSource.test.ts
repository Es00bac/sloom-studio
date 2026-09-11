import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../electron/main.mjs', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');

describe('Electron remote phone-host integration source', () => {
  it('keeps native bearer credentials in main, refuses redirects, streams requests, and maps failures', () => {
    expect(mainSource).toContain('let remotePhoneHostToken;');
    expect(mainSource).toContain("headers.Authorization = `Bearer ${remotePhoneHostToken}`");
    expect(mainSource).toContain("redirect: 'error'");
    expect(mainSource).toContain('signal: request.signal');
    expect(mainSource).toContain("init.duplex = 'half'");
    expect(mainSource).toContain("request.headers.get('x-signal-loom-phone-generation')");
    expect(mainSource).toContain('requestGeneration === remotePhoneHostGeneration');
    expect(mainSource).toContain('remotePhoneHostToken = body.token');
    expect(mainSource).toContain('remotePhoneHostToken = undefined');
    expect(mainSource).toContain("{ status: 502 }");
  });

  it('separates harmless address configuration from authority activation', () => {
    const configureStart = mainSource.indexOf("ipcMain.handle('signal-loom:remote-phone-host-configure'");
    const activateStart = mainSource.indexOf("ipcMain.handle('signal-loom:remote-phone-host-activate'");
    const disconnectStart = mainSource.indexOf("ipcMain.handle('signal-loom:remote-phone-host-disconnect'");
    const configureBlock = mainSource.slice(configureStart, activateStart);
    const activateBlock = mainSource.slice(activateStart, disconnectStart);

    expect(configureBlock).not.toContain('remotePhoneHostLocalSaveSuspended = true');
    expect(configureBlock).not.toContain('remotePhoneHostAuthorityActive = true');
    expect(activateBlock).toContain('remotePhoneHostLocalSaveSuspended = true');
    expect(activateBlock).toContain('remotePhoneHostAuthorityActive = true');
    expect(activateBlock).toContain('remotePhoneHostVerifiedGeneration !== remotePhoneHostGeneration');
    expect(preloadSource).toContain('activateRemotePhoneHost:');
    expect(preloadSource).toContain('markRemotePhoneHostSeeded:');
  });

  it('accepts QR completion in main without returning the Hane bearer to the renderer', () => {
    const pollStart = mainSource.indexOf("ipcMain.handle('signal-loom:hane-qr-pairing-poll'");
    const cancelStart = mainSource.indexOf("ipcMain.handle('signal-loom:hane-qr-pairing-cancel'");
    const pollBlock = mainSource.slice(pollStart, cancelStart);

    expect(pollStart).toBeGreaterThan(-1);
    expect(pollBlock).toContain('configureRemotePhoneHostState(outcome.haneUrl, outcome.token)');
    expect(pollBlock).toContain('tokenCustodied: true');
    expect(pollBlock).not.toContain('token: outcome.token');
    expect(preloadSource).toContain('beginHaneQrPairing:');
    expect(preloadSource).toContain('pollHaneQrPairing:');
    expect(preloadSource).toContain('cancelHaneQrPairing:');
  });

  it('blocks local writes and project switches until a disconnected session commits New or Open', () => {
    expect(mainSource).toContain('remotePhoneHostAuthorityActive || remotePhoneHostLocalSaveSuspended');
    expect(mainSource).toContain('if (remotePhoneHostAuthorityActive)');
    expect(mainSource).toContain("code: 'phone-host-authority'");
    expect(mainSource).toContain("return { status: 'blocked', reason: 'phone-host-authority' };");
    expect(mainSource).toContain('!remotePhoneHostAuthorityActive && !result?.rejected');
    expect(mainSource).toContain('isSaveAuthorityLive');

    const disconnectStart = mainSource.indexOf("ipcMain.handle('signal-loom:remote-phone-host-disconnect'");
    const statusStart = mainSource.indexOf("ipcMain.handle('signal-loom:remote-phone-host-status'");
    const disconnectBlock = mainSource.slice(disconnectStart, statusStart);
    expect(disconnectBlock).toContain('remotePhoneHostAuthorityActive = false');
    expect(disconnectBlock).toContain('if (!remotePhoneHostStateSeeded) remotePhoneHostLocalSaveSuspended = false');
  });

  it('guards standalone Paper and Image file IPC while the phone owns renderer state', () => {
    for (const channel of [
      'signal-loom:image-open',
      'signal-loom:image-save-as',
      'signal-loom:image-write-path',
      'signal-loom:paper-open',
      'signal-loom:paper-save-as',
      'signal-loom:paper-write-path',
    ]) {
      const start = mainSource.indexOf(`ipcMain.handle('${channel}'`);
      expect(start).toBeGreaterThan(-1);
      expect(mainSource.slice(start, start + 900)).toContain('assertLocalStandaloneDocumentIoAllowed');
    }
    expect(mainSource).toContain("error.code = 'phone-host-authority'");
  });
});
