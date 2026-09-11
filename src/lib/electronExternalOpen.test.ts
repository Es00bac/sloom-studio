import { describe, expect, it, vi } from 'vitest';
import { linkSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type ClassifiedExternalOpenTarget =
  | { status: 'accepted'; kind: 'project' | 'paper'; filePath: string }
  | { status: 'accepted'; kind: 'workspace'; workspace: string }
  | { status: 'ignored'; reason: string }
  | { status: 'rejected'; reason: string; value: string };

interface ExternalOpenQueue {
  enqueueValue: (
    rawValue: unknown,
    context: { cwd?: string; platform?: string; deliveryId?: string },
  ) =>
    | { status: 'enqueued'; kind: string }
    | { status: 'duplicate'; kind: string }
    | { status: 'ignored'; reason: string }
    | { status: 'rejected'; reason: string; value: string };
  enqueueArgv: (
    argv: readonly string[],
    context: { cwd?: string; platform?: string; appPath?: string; execPath?: string; deliveryId?: string },
  ) => { enqueued: Array<{ kind: string }>; rejected: Array<{ value: string; reason: string }> };
  hasPending: (kind?: string) => boolean;
  pendingCount: () => number;
  takeWorkspaceRequests: () => Array<{ kind: 'workspace'; workspace: string }>;
  authorizeRenderer: (rendererId: string) => { authorized: true; epoch: string };
  offerNextDocumentIntent: (authorization: { rendererId: string; epoch: string }) =>
    | { status: 'offered'; intent: { id: string; kind: 'project' | 'paper'; filePath: string; bytes?: Uint8Array } }
    | { status: 'empty' | 'unauthorized' };
  acceptDocumentIntent: (request: { rendererId: string; epoch: string; intentId: string }) => { status: string };
  rejectDocumentIntent: (request: { rendererId: string; epoch: string; intentId: string }) => { status: string };
  commitDocumentIntent: (request: { rendererId: string; epoch: string; intentId: string }) => { status: string };
  revokeRenderer: (request: { rendererId: string; epoch: string }) => { status: string };
}

interface ElectronExternalOpenModule {
  EXTERNAL_OPEN_DEEP_LINK_SCHEME: string;
  EXTERNAL_OPEN_DOCUMENT_EXTENSIONS: Record<string, 'project' | 'paper'>;
  classifyExternalOpenTarget: (
    rawValue: unknown,
    context?: { cwd?: string; platform?: string; workspaceViews?: readonly string[] },
  ) => ClassifiedExternalOpenTarget;
  extractExternalOpenCandidatesFromArgv: (
    argv: readonly unknown[],
    context?: { appPath?: string; execPath?: string },
  ) => string[];
  buildSecondInstanceOpenPayload: (
    argv: readonly string[],
    workingDirectory: string,
    deliveryId?: string,
  ) => { kind: string; version: number; argv: string[]; workingDirectory: string; deliveryId?: string };
  parseSecondInstanceOpenPayload: (
    value: unknown,
  ) => { argv: string[]; workingDirectory: string; deliveryId?: string } | undefined;
  canonicalizeExternalOpenFilePath: (
    filePath: string,
    context?: {
      platform?: string;
      resolveRealPath?: (filePath: string) => string;
      readStat?: (descriptor: unknown) => {
        isFile: () => boolean;
        dev?: number;
        ino?: number;
        size?: number;
        mtimeMs?: number;
        ctimeMs?: number;
      };
      openFile?: (filePath: string) => unknown;
      readBytes?: (descriptor: unknown) => Uint8Array;
      closeFile?: (descriptor: unknown) => void;
    },
  ) => { status: 'accepted'; filePath: string; fileIdentity: string; bytes: Uint8Array; byteDigest: string } | { status: 'rejected'; reason: string };
  mergeExternalOpenSourceRollback: (previous: unknown, staged: unknown, current: unknown) => {
    bins: Array<{ id: string; items: Array<{ id: string; label?: string }> }>;
    dismissedSourceKeys: string[];
  };
  createExternalOpenQueue: (options: {
    canonicalizeFile?: (filePath: string, context?: { platform?: string }) =>
      | { status: 'accepted'; filePath: string; fileIdentity: string }
      | { status: 'rejected'; reason: string };
    workspaceViews?: readonly string[];
    maxPending?: number;
  }) => ExternalOpenQueue;
}

async function loadExternalOpenModule(): Promise<ElectronExternalOpenModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/external-open.cjs') as ElectronExternalOpenModule;
}

const canonicalizeByPath = (filePath: string) => ({
  status: 'accepted' as const,
  filePath,
  fileIdentity: `path:${filePath}`,
});

describe('external open target classification', () => {
  it('accepts absolute .sloom and .slppr paths with case-insensitive extensions', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('/home/user/comic.sloom', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: '/home/user/comic.sloom',
    });
    expect(classifyExternalOpenTarget('/home/user/layout.slppr', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'paper',
      filePath: '/home/user/layout.slppr',
    });
    expect(classifyExternalOpenTarget('/home/user/UPPER.SLOOM', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: '/home/user/UPPER.SLOOM',
    });
  });

  it('accepts paths with spaces and non-ASCII characters', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('/home/user/My Comic Vol 2.sloom', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: '/home/user/My Comic Vol 2.sloom',
    });
    expect(classifyExternalOpenTarget('/home/user/週刊マンガ.slppr', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'paper',
      filePath: '/home/user/週刊マンガ.slppr',
    });
  });

  it('resolves relative paths against the provided launch directory', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('projects/comic.sloom', { cwd: '/home/user', platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: '/home/user/projects/comic.sloom',
    });
    expect(classifyExternalOpenTarget('comic.sloom', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'relative-without-base',
    });
  });

  it('decodes local file:// URLs including spaces and non-ASCII, rejecting remote hosts', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('file:///home/user/My%20Comic.sloom', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: '/home/user/My Comic.sloom',
    });
    expect(
      classifyExternalOpenTarget('file:///home/user/%E9%80%B1%E5%88%8A.slppr', { platform: 'linux' }),
    ).toEqual({
      status: 'accepted',
      kind: 'paper',
      filePath: '/home/user/週刊.slppr',
    });
    expect(classifyExternalOpenTarget('file://fileserver/share/comic.sloom', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'remote-target',
    });
  });

  it('rejects remote URL schemes outright', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    for (const value of [
      'https://example.com/comic.sloom',
      'http://example.com/comic.sloom',
      'ftp://example.com/comic.sloom',
      'smb://nas/comic.sloom',
    ]) {
      expect(classifyExternalOpenTarget(value, { platform: 'linux' })).toMatchObject({
        status: 'rejected',
        reason: 'remote-target',
      });
    }
  });

  it('accepts only defined signal-loom workspace deep links', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('signal-loom://workspace/paper', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'workspace',
      workspace: 'paper',
    });
    expect(classifyExternalOpenTarget('signal-loom://workspace/flow', { platform: 'linux' })).toEqual({
      status: 'accepted',
      kind: 'workspace',
      workspace: 'flow',
    });
    expect(classifyExternalOpenTarget('signal-loom://workspace/bogus', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-deep-link',
    });
    expect(classifyExternalOpenTarget('signal-loom://open?file=/etc/passwd', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-deep-link',
    });
    expect(classifyExternalOpenTarget('signal-loom://workspace/paper/extra', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-deep-link',
    });
  });

  it('rejects unsupported document extensions', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    for (const value of ['/home/user/image.slimg', '/home/user/notes.txt', '/home/user/comic.sloom.bak', '/home/user/archive.zip']) {
      expect(classifyExternalOpenTarget(value, { platform: 'linux' })).toMatchObject({
        status: 'rejected',
        reason: 'unsupported-extension',
      });
    }
  });

  it('ignores switch-shaped command-like values instead of treating them as files', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    for (const value of ['--dev', '--gpu-launcher=/tmp/evil.sloom', '-rf', '--allow-file-access-from-files']) {
      expect(classifyExternalOpenTarget(value, { platform: 'linux' })).toMatchObject({
        status: 'ignored',
        reason: 'command-like-argument',
      });
    }
  });

  it('rejects malformed and injection-shaped values', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('/home/user/a\u0000b.sloom', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'control-characters',
    });
    expect(classifyExternalOpenTarget('/home/user/line\nbreak.sloom', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'control-characters',
    });
    expect(classifyExternalOpenTarget('file:///%ZZ.sloom', { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'malformed',
    });
    expect(classifyExternalOpenTarget(`/home/user/${'a'.repeat(5000)}.sloom`, { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'malformed',
    });
    expect(classifyExternalOpenTarget(42, { platform: 'linux' })).toMatchObject({
      status: 'rejected',
      reason: 'malformed',
    });
  });

  it('ignores empty values and the current-directory token', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('', { platform: 'linux' })).toMatchObject({ status: 'ignored', reason: 'empty' });
    expect(classifyExternalOpenTarget('   ', { platform: 'linux' })).toMatchObject({ status: 'ignored', reason: 'empty' });
    expect(classifyExternalOpenTarget('.', { platform: 'linux' })).toMatchObject({
      status: 'ignored',
      reason: 'current-directory',
    });
  });

  it('treats Windows drive-letter paths as local absolute paths, not URL schemes', async () => {
    const { classifyExternalOpenTarget } = await loadExternalOpenModule();

    expect(classifyExternalOpenTarget('C:\\Users\\artist\\comic.sloom', { platform: 'win32' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: 'C:\\Users\\artist\\comic.sloom',
    });
    expect(classifyExternalOpenTarget('file:///C:/Users/artist/comic.sloom', { platform: 'win32' })).toEqual({
      status: 'accepted',
      kind: 'project',
      filePath: 'C:/Users/artist/comic.sloom',
    });
  });
});

describe('external open argv extraction', () => {
  it('skips the executable, app path, current-directory token, dev flag, and chromium switches', async () => {
    const { extractExternalOpenCandidatesFromArgv } = await loadExternalOpenModule();

    const candidates = extractExternalOpenCandidatesFromArgv(
      [
        '/usr/lib/electron/electron',
        '--use-gl=angle',
        '--enable-features=CanvasOopRasterization',
        '.',
        '--dev',
        '/home/user/comic.sloom',
        '/home/user/layout.slppr',
      ],
      { appPath: '/home/user/repo', execPath: '/usr/lib/electron/electron' },
    );

    expect(candidates).toEqual(['/home/user/comic.sloom', '/home/user/layout.slppr']);
  });

  it('skips the packaged binary and app path tokens while preserving candidate order', async () => {
    const { extractExternalOpenCandidatesFromArgv } = await loadExternalOpenModule();

    const candidates = extractExternalOpenCandidatesFromArgv(
      ['/opt/sloom/signal-loom', '/home/user/b.slppr', '/home/user/a.sloom'],
      { appPath: '/opt/sloom/resources/app.asar', execPath: '/opt/sloom/signal-loom' },
    );

    expect(candidates).toEqual(['/home/user/b.slppr', '/home/user/a.sloom']);
  });

  it('tolerates non-string argv entries', async () => {
    const { extractExternalOpenCandidatesFromArgv } = await loadExternalOpenModule();

    expect(extractExternalOpenCandidatesFromArgv(
      [undefined, 42, '/home/user/a.sloom'] as unknown[],
      { appPath: '/opt/app', execPath: '/opt/bin' },
    )).toEqual(['/home/user/a.sloom']);
  });
});

describe('second instance open payload', () => {
  it('round-trips argv, working directory, and bounded delivery identity', async () => {
    const { buildSecondInstanceOpenPayload, parseSecondInstanceOpenPayload } = await loadExternalOpenModule();

    const payload = buildSecondInstanceOpenPayload(['/home/user/comic.sloom'], '/home/user', 'launch-27');
    expect(parseSecondInstanceOpenPayload(payload)).toEqual({
      argv: ['/home/user/comic.sloom'],
      workingDirectory: '/home/user',
      deliveryId: 'launch-27',
    });
  });

  it('rejects malformed payloads', async () => {
    const { parseSecondInstanceOpenPayload } = await loadExternalOpenModule();

    expect(parseSecondInstanceOpenPayload(undefined)).toBeUndefined();
    expect(parseSecondInstanceOpenPayload(null)).toBeUndefined();
    expect(parseSecondInstanceOpenPayload({ kind: 'other', argv: [], workingDirectory: '/' })).toBeUndefined();
    expect(parseSecondInstanceOpenPayload({ kind: 'signal-loom-external-open', version: 1, argv: 'x', workingDirectory: '/' })).toBeUndefined();
    expect(parseSecondInstanceOpenPayload({
      kind: 'signal-loom-external-open',
      version: 1,
      argv: [42],
      workingDirectory: '/',
    })).toBeUndefined();
    expect(parseSecondInstanceOpenPayload({
      kind: 'signal-loom-external-open',
      version: 1,
      argv: Array.from({ length: 500 }, () => '/a.sloom'),
      workingDirectory: '/',
    })).toBeUndefined();
    expect(parseSecondInstanceOpenPayload({
      kind: 'signal-loom-external-open',
      version: 1,
      argv: ['/a.sloom'],
      workingDirectory: '/',
      deliveryId: 'x'.repeat(257),
    })).toBeUndefined();
  });
});

describe('external open canonical file identity', () => {
  it('collapses real, relative, symlink, and observable hard-link aliases with Unicode and spaces', async () => {
    const { canonicalizeExternalOpenFilePath, createExternalOpenQueue } = await loadExternalOpenModule();
    const root = mkdtempSync(join(tmpdir(), 'sloom-canonical-'));
    const real = join(root, 'Comic 週刊 volume 1.sloom');
    const symlink = join(root, 'Comic alias.sloom');
    const hardLink = join(root, 'Comic hard link.sloom');
    try {
      writeFileSync(real, '{}\n');
      symlinkSync(real, symlink);
      linkSync(real, hardLink);
      const realIdentity = canonicalizeExternalOpenFilePath(real);
      const relativeIdentity = canonicalizeExternalOpenFilePath(join(root, '.', 'Comic 週刊 volume 1.sloom'));
      const symlinkIdentity = canonicalizeExternalOpenFilePath(symlink);
      const hardLinkIdentity = canonicalizeExternalOpenFilePath(hardLink);
      expect(realIdentity).toMatchObject({ status: 'accepted', filePath: real });
      expect(relativeIdentity).toEqual(realIdentity);
      expect(symlinkIdentity).toEqual(realIdentity);
      expect(hardLinkIdentity).toMatchObject({ status: 'accepted' });
      if (realIdentity.status !== 'accepted' || hardLinkIdentity.status !== 'accepted') throw new Error('Expected files.');
      expect(hardLinkIdentity.fileIdentity).toBe(realIdentity.fileIdentity);

      const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeExternalOpenFilePath });
      expect(queue.enqueueValue(real, { platform: process.platform, deliveryId: 'same-os-event' })).toMatchObject({ status: 'enqueued' });
      expect(queue.enqueueValue(symlink, { platform: process.platform, deliveryId: 'same-os-event' })).toMatchObject({ status: 'duplicate' });
      expect(queue.enqueueValue(hardLink, { platform: process.platform, deliveryId: 'same-os-event' })).toMatchObject({ status: 'duplicate' });
      const authorization = queue.authorizeRenderer('renderer-canonical');
      const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-canonical', epoch: authorization.epoch });
      if (offer.status !== 'offered') throw new Error('Expected one canonical offer.');
      expect(queue.acceptDocumentIntent({
        rendererId: 'renderer-canonical',
        epoch: authorization.epoch,
        intentId: offer.intent.id,
      })).toMatchObject({ status: 'accepted' });
      expect(queue.commitDocumentIntent({
        rendererId: 'renderer-canonical',
        epoch: authorization.epoch,
        intentId: offer.intent.id,
      })).toMatchObject({ status: 'committed' });
      expect(queue.enqueueValue(symlink, { platform: process.platform, deliveryId: 'same-os-event' }))
        .toMatchObject({ status: 'duplicate' });
      expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-canonical', epoch: authorization.epoch }))
        .toEqual({ status: 'empty' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('defines missing/non-file failures and platform case fallback semantics', async () => {
    const { canonicalizeExternalOpenFilePath } = await loadExternalOpenModule();
    const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(canonicalizeExternalOpenFilePath('/missing.sloom', {
      resolveRealPath: () => { throw missingError; },
    })).toEqual({ status: 'rejected', reason: 'missing-file' });
    expect(canonicalizeExternalOpenFilePath('/directory.sloom', {
      resolveRealPath: (value) => value,
      readStat: () => ({ isFile: () => false }),
    })).toEqual({ status: 'rejected', reason: 'not-a-file' });

    const windowsUpper = canonicalizeExternalOpenFilePath('C:\\Art\\Comic.sloom', {
      platform: 'win32',
      resolveRealPath: (value) => value,
      readStat: () => ({ isFile: () => true, dev: 0, ino: 0 }),
    });
    const windowsLower = canonicalizeExternalOpenFilePath('c:\\art\\comic.sloom', {
      platform: 'win32',
      resolveRealPath: (value) => value,
      readStat: () => ({ isFile: () => true, dev: 0, ino: 0 }),
    });
    expect(windowsUpper).toMatchObject({ status: 'accepted', fileIdentity: 'path:c:\\art\\comic.sloom' });
    expect(windowsLower).toMatchObject({ status: 'accepted', fileIdentity: 'path:c:\\art\\comic.sloom' });
    const linuxUpper = canonicalizeExternalOpenFilePath('/Art/Comic.sloom', {
      platform: 'linux',
      resolveRealPath: (value) => value,
      readStat: () => ({ isFile: () => true, dev: 0, ino: 0 }),
    });
    const linuxLower = canonicalizeExternalOpenFilePath('/art/comic.sloom', {
      platform: 'linux',
      resolveRealPath: (value) => value,
      readStat: () => ({ isFile: () => true, dev: 0, ino: 0 }),
    });
    expect(linuxUpper).not.toEqual(linuxLower);
  });

  it('rejects a file that mutates while its enqueue snapshot is being read', async () => {
    const { canonicalizeExternalOpenFilePath } = await loadExternalOpenModule();
    const closeFile = vi.fn();
    let statRead = 0;
    const outcome = canonicalizeExternalOpenFilePath('/changing.sloom', {
      resolveRealPath: (value) => value,
      openFile: () => 7,
      readStat: () => ({
        isFile: () => true,
        dev: 1,
        ino: 2,
        size: 1,
        ctimeMs: statRead++ === 0 ? 10 : 11,
      }),
      readBytes: () => new Uint8Array([65]),
      closeFile,
    });

    expect(outcome).toEqual({ status: 'rejected', reason: 'file-changed-during-read' });
    expect(closeFile).toHaveBeenCalledWith(7);
  });
});

describe('external open queue', () => {
  const context = { cwd: '/home/user', platform: 'linux' };

  it('enqueues validated document targets and commits them exactly once', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });

    expect(queue.enqueueValue('/home/user/comic.sloom', context)).toMatchObject({ status: 'enqueued', kind: 'project' });
    expect(queue.enqueueValue('/home/user/layout.slppr', context)).toMatchObject({ status: 'enqueued', kind: 'paper' });
    expect(queue.hasPending()).toBe(true);
    expect(queue.hasPending('project')).toBe(true);
    expect(queue.pendingCount()).toBe(2);

    const authorization = queue.authorizeRenderer('renderer-a');
    for (const expected of [
      { kind: 'project', filePath: '/home/user/comic.sloom' },
      { kind: 'paper', filePath: '/home/user/layout.slppr' },
    ]) {
      const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
      expect(offer).toMatchObject({ status: 'offered', intent: expected });
      if (offer.status !== 'offered') throw new Error('Expected an offered intent.');
      expect(queue.acceptDocumentIntent({
        rendererId: 'renderer-a',
        epoch: authorization.epoch,
        intentId: offer.intent.id,
      })).toMatchObject({ status: 'accepted' });
      expect(queue.commitDocumentIntent({
        rendererId: 'renderer-a',
        epoch: authorization.epoch,
        intentId: offer.intent.id,
      })).toMatchObject({ status: 'committed' });
    }
    expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch })).toEqual({ status: 'empty' });
    expect(queue.hasPending()).toBe(false);
  });

  it('keeps committed delivery identity after delay/capacity churn and permits a later user event', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath, maxPending: 600 });
    const firstContext = { ...context, deliveryId: 'os-delivery-original' };

    expect(queue.enqueueValue('/home/user/comic.sloom', firstContext)).toMatchObject({ status: 'enqueued' });
    expect(queue.enqueueValue('/home/user/comic.sloom', firstContext)).toMatchObject({ status: 'duplicate' });
    expect(queue.pendingCount()).toBe(1);

    const authorization = queue.authorizeRenderer('renderer-a');
    const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
    expect(offer.status).toBe('offered');
    if (offer.status !== 'offered') throw new Error('Expected an offered intent.');
    expect(queue.acceptDocumentIntent({
      rendererId: 'renderer-a',
      epoch: authorization.epoch,
      intentId: offer.intent.id,
    })).toMatchObject({ status: 'accepted' });
    expect(queue.commitDocumentIntent({
      rendererId: 'renderer-a',
      epoch: authorization.epoch,
      intentId: offer.intent.id,
    })).toMatchObject({ status: 'committed' });

    for (let index = 0; index < 512; index += 1) {
      const path = `/home/user/churn-${index}.sloom`;
      expect(queue.enqueueValue(path, { ...context, deliveryId: `churn-${index}` })).toMatchObject({ status: 'enqueued' });
      const churnOffer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
      if (churnOffer.status !== 'offered') throw new Error('Expected churn offer.');
      queue.acceptDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch, intentId: churnOffer.intent.id });
      queue.commitDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch, intentId: churnOffer.intent.id });
    }
    expect(queue.enqueueValue('/home/user/comic.sloom', firstContext)).toMatchObject({ status: 'duplicate' });
    expect(queue.enqueueValue('/home/user/comic.sloom', { ...context, deliveryId: 'os-delivery-genuine-later' }))
      .toMatchObject({ status: 'enqueued' });
  });

  it('binds an event to enqueue-time bytes and never reaccepts it after the path changes inode', async () => {
    const { canonicalizeExternalOpenFilePath, createExternalOpenQueue } = await loadExternalOpenModule();
    const root = mkdtempSync(join(tmpdir(), 'sloom-file-snapshot-'));
    const target = join(root, 'same-name.sloom');
    const moved = join(root, 'original.sloom');
    try {
      writeFileSync(target, '{"name":"A"}');
      const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeExternalOpenFilePath });
      expect(queue.enqueueValue(target, { platform: process.platform, deliveryId: 'one-delivered-argv-message' }))
        .toMatchObject({ status: 'enqueued' });

      renameSync(target, moved);
      writeFileSync(target, '{"name":"B"}');
      const authorization = queue.authorizeRenderer('renderer-snapshot');
      const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-snapshot', epoch: authorization.epoch });
      if (offer.status !== 'offered') throw new Error('Expected the enqueue-time snapshot.');
      expect(Buffer.from(offer.intent.bytes ?? []).toString('utf8')).toBe('{"name":"A"}');
      queue.acceptDocumentIntent({ rendererId: 'renderer-snapshot', epoch: authorization.epoch, intentId: offer.intent.id });
      queue.commitDocumentIntent({ rendererId: 'renderer-snapshot', epoch: authorization.epoch, intentId: offer.intent.id });

      expect(queue.enqueueValue(target, { platform: process.platform, deliveryId: 'one-delivered-argv-message' }))
        .toMatchObject({ status: 'duplicate' });
      expect(queue.enqueueValue(target, { platform: process.platform, deliveryId: 'genuinely-new-user-open' }))
        .toMatchObject({ status: 'enqueued' });
      const laterOffer = queue.offerNextDocumentIntent({ rendererId: 'renderer-snapshot', epoch: authorization.epoch });
      if (laterOffer.status !== 'offered') throw new Error('Expected the later user open.');
      expect(Buffer.from(laterOffer.intent.bytes ?? []).toString('utf8')).toBe('{"name":"B"}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('deduplicates a repeated argv callback by its stable event identity while allowing a later launch', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });
    const argv = ['/opt/sloom', '/home/user/comic.sloom'];
    const argvContext = { ...context, execPath: '/opt/sloom', deliveryId: 'loser-launch-token' };
    expect(queue.enqueueArgv(argv, argvContext).enqueued).toHaveLength(1);
    expect(queue.enqueueArgv(argv, argvContext).enqueued).toHaveLength(0);
    const authorization = queue.authorizeRenderer('renderer-event');
    const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-event', epoch: authorization.epoch });
    if (offer.status !== 'offered') throw new Error('Expected one event.');
    queue.acceptDocumentIntent({ rendererId: 'renderer-event', epoch: authorization.epoch, intentId: offer.intent.id });
    queue.commitDocumentIntent({ rendererId: 'renderer-event', epoch: authorization.epoch, intentId: offer.intent.id });
    expect(queue.enqueueArgv(argv, argvContext).enqueued).toHaveLength(0);
    expect(queue.enqueueArgv(argv, { ...argvContext, deliveryId: 'next-loser-launch-token' }).enqueued).toHaveLength(1);
  });

  it('does not consume or deduplicate a rejected dirty-guard intent', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });
    queue.enqueueValue('/home/user/comic.sloom', context);

    const authorization = queue.authorizeRenderer('renderer-a');
    const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
    if (offer.status !== 'offered') throw new Error('Expected an offered intent.');
    expect(queue.rejectDocumentIntent({
      rendererId: 'renderer-a',
      epoch: authorization.epoch,
      intentId: offer.intent.id,
    })).toMatchObject({ status: 'rejected' });
    expect(queue.pendingCount()).toBe(0);
    expect(queue.enqueueValue('/home/user/comic.sloom', context)).toMatchObject({ status: 'enqueued' });
  });

  it('can reject after acceptance and still permits a deliberate retry', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });
    queue.enqueueValue('/home/user/comic.sloom', context);
    const authorization = queue.authorizeRenderer('renderer-a');
    const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
    if (offer.status !== 'offered') throw new Error('Expected an offered intent.');
    queue.acceptDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch, intentId: offer.intent.id });

    expect(queue.rejectDocumentIntent({
      rendererId: 'renderer-a',
      epoch: authorization.epoch,
      intentId: offer.intent.id,
    })).toMatchObject({ status: 'rejected' });
    expect(queue.enqueueValue('/home/user/comic.sloom', context)).toMatchObject({ status: 'enqueued' });
  });

  it('returns committed again when the renderer retries after losing the first commit response', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });
    queue.enqueueValue('/home/user/comic.sloom', context);
    const authorization = queue.authorizeRenderer('renderer-a');
    const offer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch });
    if (offer.status !== 'offered') throw new Error('Expected an offered intent.');
    const request = { rendererId: 'renderer-a', epoch: authorization.epoch, intentId: offer.intent.id };
    queue.acceptDocumentIntent(request);

    expect(queue.commitDocumentIntent(request)).toMatchObject({ status: 'committed' });
    expect(queue.commitDocumentIntent(request)).toMatchObject({ status: 'committed' });
  });

  it('authorizes one renderer epoch and rejects stale or competing drains', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });
    queue.enqueueValue('/home/user/comic.sloom', context);

    const first = queue.authorizeRenderer('renderer-a');
    expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-b', epoch: first.epoch })).toMatchObject({
      status: 'unauthorized',
    });
    const firstOffer = queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: first.epoch });
    expect(firstOffer.status).toBe('offered');

    expect(queue.revokeRenderer({ rendererId: 'renderer-a', epoch: first.epoch })).toMatchObject({ status: 'revoked' });
    const second = queue.authorizeRenderer('renderer-a');
    expect(second.epoch).not.toBe(first.epoch);
    expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: first.epoch })).toMatchObject({
      status: 'unauthorized',
    });
    expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: second.epoch })).toMatchObject({
      status: 'offered',
    });
  });

  it('rejects targets that are not existing regular files', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({
      canonicalizeFile: (filePath: string) => filePath.endsWith('exists.sloom')
        ? canonicalizeByPath(filePath)
        : { status: 'rejected' as const, reason: 'missing-file' },
    });

    expect(queue.enqueueValue('/home/user/missing.sloom', context)).toMatchObject({
      status: 'rejected',
      reason: 'missing-file',
    });
    expect(queue.enqueueValue('/home/user/exists.sloom', context)).toMatchObject({ status: 'enqueued' });
    expect(queue.pendingCount()).toBe(1);
  });

  it('keeps workspace deep links separate from document requests', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });

    expect(queue.enqueueValue('signal-loom://workspace/paper', context)).toMatchObject({
      status: 'enqueued',
      kind: 'workspace',
    });
    expect(queue.enqueueValue('/home/user/comic.sloom', context)).toMatchObject({ status: 'enqueued' });

    expect(queue.hasPending('workspace')).toBe(true);
    const authorization = queue.authorizeRenderer('renderer-a');
    expect(queue.offerNextDocumentIntent({ rendererId: 'renderer-a', epoch: authorization.epoch })).toMatchObject({
      status: 'offered',
      intent: { kind: 'project', filePath: '/home/user/comic.sloom' },
    });
    expect(queue.takeWorkspaceRequests()).toEqual([{ kind: 'workspace', workspace: 'paper' }]);
    expect(queue.takeWorkspaceRequests()).toEqual([]);
  });

  it('enqueues from raw argv, reporting rejected values without dropping valid ones', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath });

    const outcome = queue.enqueueArgv(
      [
        '/opt/sloom/signal-loom',
        '--original-process-start-time=1234',
        '/home/user/comic.sloom',
        'https://example.com/evil.sloom',
        '/home/user/notes.txt',
      ],
      { ...context, appPath: '/opt/sloom/resources/app.asar', execPath: '/opt/sloom/signal-loom' },
    );

    expect(outcome.enqueued).toEqual([{ kind: 'project', filePath: '/home/user/comic.sloom' }]);
    expect(outcome.rejected).toEqual([
      { value: 'https://example.com/evil.sloom', reason: 'remote-target' },
      { value: '/home/user/notes.txt', reason: 'unsupported-extension' },
    ]);
    expect(queue.pendingCount()).toBe(1);
  });

  it('caps the pending queue to a bounded size', async () => {
    const { createExternalOpenQueue } = await loadExternalOpenModule();
    const queue = createExternalOpenQueue({ canonicalizeFile: canonicalizeByPath, maxPending: 2 });

    expect(queue.enqueueValue('/home/user/a.sloom', context)).toMatchObject({ status: 'enqueued' });
    expect(queue.enqueueValue('/home/user/b.sloom', context)).toMatchObject({ status: 'enqueued' });
    expect(queue.enqueueValue('/home/user/c.sloom', context)).toMatchObject({
      status: 'rejected',
      reason: 'queue-overflow',
    });
  });
});

describe('external project Source rollback', () => {
  it('removes transaction-owned replacement state while preserving concurrent Source mutations', async () => {
    const { mergeExternalOpenSourceRollback } = await loadExternalOpenModule();
    const previous = {
      bins: [{ id: 'default', name: 'Previous', items: [
        { id: 'kept', label: 'Kept before open' },
        { id: 'removed-concurrently', label: 'Remove me' },
      ] }],
      dismissedSourceKeys: ['previous-dismissed'],
    };
    const staged = {
      bins: [{ id: 'default', name: 'Incoming project', items: [
        { id: 'incoming-owned', label: 'Incoming only' },
        { id: 'renamed-concurrently', label: 'Before rename' },
        { id: 'removed-concurrently', label: 'Remove me' },
      ] }],
      dismissedSourceKeys: ['incoming-dismissed'],
    };
    const current = {
      bins: [
        { id: 'default', name: 'Incoming project', items: [
          { id: 'incoming-owned', label: 'Incoming only' },
          { id: 'renamed-concurrently', label: 'After rename' },
          { id: 'concurrent-add', label: 'Added elsewhere' },
        ] },
        { id: 'concurrent-bin', name: 'Other workspace', items: [{ id: 'other', label: 'Other' }] },
      ],
      dismissedSourceKeys: ['incoming-dismissed', 'concurrent-dismissed'],
    };

    const rolledBack = mergeExternalOpenSourceRollback(previous, staged, current);
    expect(rolledBack.bins).toEqual([
      { id: 'default', name: 'Previous', items: [
        { id: 'kept', label: 'Kept before open' },
        { id: 'renamed-concurrently', label: 'After rename' },
        { id: 'concurrent-add', label: 'Added elsewhere' },
      ] },
      { id: 'concurrent-bin', name: 'Other workspace', items: [{ id: 'other', label: 'Other' }] },
    ]);
    expect(rolledBack.dismissedSourceKeys).toEqual(['previous-dismissed', 'concurrent-dismissed']);
  });
});
