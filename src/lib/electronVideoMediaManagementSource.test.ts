import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function ipcHandler(source: string, channel: string, nextChannel: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  const end = source.indexOf(`ipcMain.handle('${nextChannel}'`, start + 1);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

describe('Electron Video media-management wiring', () => {
  it('keeps relink selection, verification, capability registration, and Source commit in main', () => {
    const source = read('electron/main.mjs');
    const handler = ipcHandler(source, 'signal-loom:video-media-relink', 'signal-loom:video-media-availability');

    expect(handler).toContain('projectAuthority.authorizeSave');
    expect(handler).toContain('dialog.showOpenDialog');
    expect(handler).toContain("properties: ['openFile']");
    expect(handler).toContain('projectAuthority.runAuthorizedMutation');
    expect(handler).toContain('inspectRelinkCandidate');
    expect(handler).toContain('prepareNativeAssetCapabilitiesFromSourceBin');
    expect(handler).toContain('verifiedExternalPaths: [inspected.canonicalPath]');
    expect(handler).not.toContain('allowExternal: true');
    expect(handler).toContain('commitSourceLibrarySnapshot');
    expect(handler).toContain("change: { type: 'source-library-snapshot', snapshot }");
    expect(handler).not.toContain('request?.filePath');
  });

  it('asks main for capability availability by item identity without accepting renderer paths', () => {
    const source = read('electron/main.mjs');
    const handler = ipcHandler(source, 'signal-loom:video-media-availability', 'signal-loom:video-media-consolidate');

    expect(handler).toContain('projectAuthority.authorizeSave');
    expect(handler).toContain('request?.itemIds');
    expect(handler).toContain('resolveRegisteredNativeAssetPath(item)');
    expect(handler).toContain('authority: projectAuthority.getCurrent()');
    expect(handler).not.toContain('request?.filePath');
    expect(handler).not.toContain('request?.nativeFilePath');
  });

  it('accepts only item identities while main chooses, stages, verifies, commits, or rolls back copies', () => {
    const source = read('electron/main.mjs');
    const handler = ipcHandler(source, 'signal-loom:video-media-consolidate', 'signal-loom:paper-choose-pdf-export-path');

    expect(handler).toContain('request?.itemIds');
    expect(handler).not.toContain('request?.targetDirectory');
    expect(handler).toContain("properties: ['openDirectory', 'createDirectory']");
    expect(handler).toContain('resolveRegisteredNativeAssetPath');
    expect(handler).toContain('createMediaConsolidationTransaction');
    expect(handler).toContain('verifiedPendingPaths: transaction.entries.map');
    expect(handler).not.toContain('allowExternal: true');
    expect(handler).toContain('transaction.commit()');
    expect(handler).toContain('transaction.rollback()');
    expect(handler).toContain('commitSourceLibrarySnapshot');
  });

  it('discloses every published destination when Source Library commit fails downstream', () => {
    const source = read('electron/main.mjs');
    const handler = ipcHandler(source, 'signal-loom:video-media-consolidate', 'signal-loom:paper-choose-pdf-export-path');
    const transactionCommit = handler.indexOf('transaction.commit()');
    const sourceCommit = handler.indexOf('commitSourceLibrarySnapshot(snapshot');

    expect(handler).toContain('let transactionCommitted = false;');
    expect(handler).toContain('transactionCommitted = true;');
    expect(handler).toContain('buildConsolidationPostCommitError(error, transaction)');
    expect(transactionCommit).toBeGreaterThan(handler.indexOf('try {'));
    expect(transactionCommit).toBeLessThan(sourceCommit);
    expect(handler.indexOf('transactionCommitted = true;')).toBeLessThan(sourceCommit);
    const management = read('electron/video-media-management.cjs');
    expect(management).toContain("error.code = 'SLOOM_CONSOLIDATION_POST_COMMIT_FAILURE'");
    expect(management).toContain('error.retainedFilePaths = retainedFilePaths;');
  });

  it('exposes the typed preload route and discoverable Video workspace actions', () => {
    const preload = read('electron/preload.cjs');
    const nativeTypes = read('src/lib/nativeApp.ts');
    const workspace = read('src/features/video/workspace/VideoWorkspace.tsx');

    expect(preload).toContain("relinkVideoMedia: (request) => ipcRenderer.invoke('signal-loom:video-media-relink', request)");
    expect(preload).toContain("consolidateVideoMedia: (request) => ipcRenderer.invoke('signal-loom:video-media-consolidate', request)");
    expect(preload).toContain("getVideoMediaAvailability: (request) => ipcRenderer.invoke('signal-loom:video-media-availability', request)");
    expect(nativeTypes).toContain('relinkVideoMedia?: (request:');
    expect(nativeTypes).toContain('consolidateVideoMedia?: (request:');
    expect(nativeTypes).toContain('getVideoMediaAvailability?: (request:');
    expect(workspace).toContain('relinkVideoMediaItem(item.id)');
    expect(workspace).toContain('consolidateVideoMediaItems(consolidatableVideoMediaItemIds)');
    expect(workspace).toContain('Consolidate Used (');
    expect(workspace).toContain('Relink…');
    expect(workspace.match(/item\?\.nativeFilePath \?\? resolveFcpMediaPathFromAssetUrl/g)).toHaveLength(2);
  });
});
