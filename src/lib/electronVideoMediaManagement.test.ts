import { linkSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface ConsolidationTransaction {
  entries: Array<{ itemId: string; targetPath: string; fileName: string; byteSize: number; fingerprint: string }>;
  commit: () => void;
  rollback: () => void;
  finalize: () => void;
}

interface VideoMediaManagementModule {
  fingerprintMediaFile: (filePath: string) => Promise<{ canonicalPath: string; byteSize: number; fingerprint: string }>;
  inspectRelinkCandidate: (request: { filePath: string; expectedFingerprint?: string }) => Promise<{ fingerprint: string }>;
  buildConsolidationPostCommitError: (cause: unknown, transaction: ConsolidationTransaction) => Error & {
    code?: string;
    retainedFileNames?: string[];
    retainedFilePaths?: string[];
  };
  createMediaConsolidationTransaction: (request: {
    entries: Array<{ itemId: string; sourcePath: string; fileName?: string; expectedFingerprint?: string }>;
    targetDirectory: string;
    transactionId?: string;
  }, dependencies?: {
    copyFileExclusive?: (sourcePath: string, stagePath: string) => Promise<void>;
    getAvailableBytes?: (directoryPath: string) => Promise<bigint>;
    promoteFileExclusive?: (stagePath: string, targetPath: string) => void;
    afterPromotionVerified?: (targetPath: string, itemId: string) => void;
  }) => Promise<ConsolidationTransaction>;
}

async function loadModule(): Promise<VideoMediaManagementModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer TypeScript module graph.
  return await import('../../electron/video-media-management.cjs') as VideoMediaManagementModule;
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sloom-media-management-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Electron professional media management transaction', () => {
  it('streams a stable SHA-256 fingerprint and rejects a mismatched relink candidate', async () => {
    const directory = await temporaryDirectory();
    const candidate = join(directory, 'camera.mov');
    await writeFile(candidate, new Uint8Array([0, 1, 2, 3, 4, 5]));
    const media = await loadModule();
    const fingerprint = await media.fingerprintMediaFile(candidate);

    expect(fingerprint).toMatchObject({
      byteSize: 6,
      fingerprint: 'sha256:17e88db187afd62c16e5debf3e6527cd006bc012bc90b51a810cd80c2d511f43',
    });
    await expect(media.inspectRelinkCandidate({ filePath: candidate, expectedFingerprint: fingerprint.fingerprint }))
      .resolves.toMatchObject({ fingerprint: fingerprint.fingerprint });
    await expect(media.inspectRelinkCandidate({ filePath: candidate, expectedFingerprint: `sha256:${'a'.repeat(64)}` }))
      .rejects.toThrow(/does not match/);
    await expect(media.inspectRelinkCandidate({ filePath: candidate, expectedFingerprint: 'sha256:malformed' }))
      .rejects.toThrow(/does not match/);

    const emptyCandidate = join(directory, 'empty.mov');
    await writeFile(emptyCandidate, new Uint8Array());
    await expect(media.inspectRelinkCandidate({ filePath: emptyCandidate }))
      .rejects.toThrow(/empty file/);
  });

  it('stages verified copies, allocates collision-safe names, and promotes without overwriting', async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = join(directory, 'source');
    const targetDirectory = join(directory, 'target');
    await Promise.all([
      import('node:fs/promises').then(({ mkdir }) => mkdir(sourceDirectory)),
      import('node:fs/promises').then(({ mkdir }) => mkdir(targetDirectory)),
    ]);
    const first = join(sourceDirectory, 'A001.mov');
    const second = join(sourceDirectory, 'A001-copy.mov');
    await writeFile(first, new Uint8Array([1, 2, 3]));
    await writeFile(second, new Uint8Array([4, 5, 6]));
    await writeFile(join(targetDirectory, 'A001.mov'), new Uint8Array([9]));
    const media = await loadModule();
    const transaction = await media.createMediaConsolidationTransaction({
      entries: [
        { itemId: 'a', sourcePath: first, fileName: 'A001.mov' },
        { itemId: 'b', sourcePath: second, fileName: 'A001.mov' },
      ],
      targetDirectory,
      transactionId: 'test',
    });

    expect(transaction.entries.map((entry) => entry.fileName)).toEqual(['A001 (2).mov', 'A001 (3).mov']);
    transaction.commit();
    transaction.finalize();
    await expect(readFile(join(targetDirectory, 'A001.mov'))).resolves.toEqual(Buffer.from([9]));
    await expect(readFile(join(targetDirectory, 'A001 (2).mov'))).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readFile(join(targetDirectory, 'A001 (3).mov'))).resolves.toEqual(Buffer.from([4, 5, 6]));
  });

  it('keeps long multibyte target names within filesystem limits and preserves the extension', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'source.mov');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(targetDirectory);
    await writeFile(source, new Uint8Array([1, 2, 3]));
    const media = await loadModule();
    const transaction = await media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'long-name', sourcePath: source, fileName: `${'映像'.repeat(100)}.mov` }],
      targetDirectory,
      transactionId: 'long-name',
    });

    expect(Buffer.byteLength(transaction.entries[0].fileName, 'utf8')).toBeLessThanOrEqual(220);
    expect(transaction.entries[0].fileName).toMatch(/\.mov$/);
    transaction.commit();
    transaction.finalize();
    await expect(readFile(transaction.entries[0].targetPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('rolls back private stages without deleting any published destination path', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'source.mov');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(targetDirectory);
    await writeFile(source, new Uint8Array([1, 2, 3]));
    const media = await loadModule();
    const staged = await media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'a', sourcePath: source, fileName: 'race.mov' }],
      targetDirectory,
      transactionId: 'race',
    });
    await writeFile(staged.entries[0].targetPath, new Uint8Array([8, 8]));

    expect(() => staged.commit()).toThrow();
    staged.rollback();
    await expect(readFile(staged.entries[0].targetPath)).resolves.toEqual(Buffer.from([8, 8]));

    const promoted = await media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'b', sourcePath: source, fileName: 'owned.mov' }],
      targetDirectory,
      transactionId: 'owned',
    });
    promoted.commit();
    promoted.rollback();
    await expect(readFile(promoted.entries[0].targetPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('never removes a foreign replacement of an earlier promoted target when a later promotion fails', async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = join(directory, 'source');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await Promise.all([mkdir(sourceDirectory), mkdir(targetDirectory)]);
    const firstSource = join(sourceDirectory, 'first.mov');
    const secondSource = join(sourceDirectory, 'second.mov');
    await writeFile(firstSource, new Uint8Array([1, 2, 3]));
    await writeFile(secondSource, new Uint8Array([4, 5, 6]));
    const media = await loadModule();
    let firstTarget = '';
    let promotions = 0;
    const transaction = await media.createMediaConsolidationTransaction({
      entries: [
        { itemId: 'first', sourcePath: firstSource, fileName: 'first.mov' },
        { itemId: 'second', sourcePath: secondSource, fileName: 'second.mov' },
      ],
      targetDirectory,
      transactionId: 'foreign-replacement',
    }, {
      promoteFileExclusive: (stagePath, targetPath) => {
        promotions += 1;
        if (promotions === 1) {
          firstTarget = targetPath;
          linkSync(stagePath, targetPath);
          return;
        }
        writeFileSync(targetPath, 'COLLISION');
        linkSync(stagePath, targetPath);
      },
      afterPromotionVerified: (targetPath) => {
        if (targetPath !== firstTarget) return;
        rmSync(firstTarget, { force: true });
        writeFileSync(firstTarget, 'FOREIGN-FILE');
      },
    });

    let failure: unknown;
    try {
      transaction.commit();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'SLOOM_CONSOLIDATION_PARTIAL_PUBLISH',
      retainedFileNames: ['first.mov'],
      message: expect.stringMatching(/paths were left untouched/),
    });
    transaction.rollback();
    await expect(readFile(firstTarget, 'utf8')).resolves.toBe('FOREIGN-FILE');
    await expect(readFile(transaction.entries[1].targetPath, 'utf8')).resolves.toBe('COLLISION');
    await expect(readdir(targetDirectory).then((entries) => entries.sort())).resolves.toEqual(['first.mov', 'second.mov']);
  });

  it('reports retained names and paths when Source Library commit fails after publication', async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = join(directory, 'source');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await Promise.all([mkdir(sourceDirectory), mkdir(targetDirectory)]);
    const firstSource = join(sourceDirectory, 'first.mov');
    const secondSource = join(sourceDirectory, 'second.mov');
    await writeFile(firstSource, new Uint8Array([1, 2, 3]));
    await writeFile(secondSource, new Uint8Array([4, 5, 6]));
    const media = await loadModule();
    const transaction = await media.createMediaConsolidationTransaction({
      entries: [
        { itemId: 'first', sourcePath: firstSource, fileName: 'first.mov' },
        { itemId: 'second', sourcePath: secondSource, fileName: 'second.mov' },
      ],
      targetDirectory,
      transactionId: 'post-commit-source-failure',
    });

    let transactionCommitted = false;
    let failure: unknown;
    try {
      transaction.commit();
      transactionCommitted = true;
      throw new Error('simulated commitSourceLibrarySnapshot failure');
    } catch (error) {
      transaction.rollback();
      failure = transactionCommitted
        ? media.buildConsolidationPostCommitError(error, transaction)
        : error;
    }

    expect(failure).toMatchObject({
      code: 'SLOOM_CONSOLIDATION_POST_COMMIT_FAILURE',
      retainedFileNames: ['first.mov', 'second.mov'],
      retainedFilePaths: [transaction.entries[0].targetPath, transaction.entries[1].targetPath],
      message: expect.stringMatching(/Source Library commit failed/),
    });
    await expect(readFile(transaction.entries[0].targetPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readFile(transaction.entries[1].targetPath)).resolves.toEqual(Buffer.from([4, 5, 6]));
  });

  it('fails the free-space preflight before creating any staged copy', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'feature.mov');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(targetDirectory);
    await writeFile(source, new Uint8Array([1, 2, 3, 4]));
    const media = await loadModule();

    await expect(media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'feature', sourcePath: source }],
      targetDirectory,
      transactionId: 'no-space',
    }, {
      getAvailableBytes: async () => 0n,
    })).rejects.toThrow(/needs .* free.*only .* available/);
    await expect(readdir(targetDirectory)).resolves.toEqual([]);
  });

  it('removes a partial stage left by a failed filesystem copy', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'feature.mov');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(targetDirectory);
    await writeFile(source, new Uint8Array([1, 2, 3, 4]));
    const media = await loadModule();

    await expect(media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'feature', sourcePath: source }],
      targetDirectory,
      transactionId: 'partial-copy',
    }, {
      copyFileExclusive: async (_sourcePath, stagePath) => {
        await writeFile(stagePath, new Uint8Array([1, 2]));
        throw new Error('simulated copy failure');
      },
    })).rejects.toThrow(/simulated copy failure/);
    await expect(readdir(targetDirectory)).resolves.toEqual([]);
  });

  it('isolates private stages from a pre-existing legacy stage path', async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, 'feature.mov');
    const targetDirectory = join(directory, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(targetDirectory);
    await writeFile(source, new Uint8Array([1, 2, 3, 4]));
    const foreignStage = join(targetDirectory, '.sloom-consolidating-stage-race-0.part');
    await writeFile(foreignStage, new Uint8Array([9, 9]));
    const media = await loadModule();

    const transaction = await media.createMediaConsolidationTransaction({
      entries: [{ itemId: 'feature', sourcePath: source }],
      targetDirectory,
      transactionId: 'stage-race',
    });
    transaction.commit();
    transaction.finalize();
    await expect(readFile(foreignStage)).resolves.toEqual(Buffer.from([9, 9]));
  });
});
