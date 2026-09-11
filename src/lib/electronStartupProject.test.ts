import { describe, expect, it, vi } from 'vitest';

interface StartupProjectModule {
  MAX_STARTUP_PROJECT_BACKUPS: number;
  buildStartupProjectRecovery: (
    filePath: string,
    error: unknown,
    phase: 'read' | 'parse' | 'prepare',
    dependencies?: { discoverBackups?: (filePath: string) => Promise<StartupProjectBackup[]> },
  ) => Promise<StartupProjectRecovery>;
  buildStartupProjectStatePath: (userDataPath: string) => string;
  discoverStartupProjectBackups: (
    filePath: string,
    dependencies: {
      readdir?: () => Promise<Array<{ name: string; isFile: () => boolean }>>;
      opendir?: () => Promise<{
        read: () => Promise<{ name: string; isFile: () => boolean } | null>;
        close: () => Promise<void>;
      }>;
      stat: (filePath: string) => Promise<{ mtimeMs: number }>;
    },
  ) => Promise<StartupProjectBackup[]>;
  parseStartupProjectReopenPreference: (contents: string) => boolean;
  parseStartupProjectState: (contents: string) => string | undefined;
  prepareRememberedStartupProject: (options: {
    filePath?: string;
    reopenLastProjectOnStartup: boolean;
    readProject: (filePath: string) => Promise<string>;
    parseProject: (contents: string) => unknown;
    prepareProject: (filePath: string, document: unknown) => Promise<unknown>;
    discoverBackups?: (filePath: string) => Promise<StartupProjectBackup[]>;
  }) => Promise<{
    status: 'blank' | 'project' | 'recovery';
    prepared?: unknown;
    recovery?: StartupProjectRecovery;
  }>;
  resolveStartupProjectPath: (filePath: string | undefined, fileExists: (filePath: string) => boolean) => string | undefined;
  serializeStartupProjectState: (filePath: string | undefined, reopenLastProjectOnStartup?: boolean) => string;
}

interface StartupProjectBackup {
  filePath: string;
  modifiedAtMs: number;
}

interface StartupProjectRecovery {
  filePath: string;
  failure: {
    code: 'missing' | 'unreadable' | 'corrupt' | 'invalid-project' | 'preparation-failed';
    message: string;
  };
  backups: StartupProjectBackup[];
}

async function loadStartupProjectModule(): Promise<StartupProjectModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/startup-project.cjs') as StartupProjectModule;
}

describe('Electron startup project state', () => {
  it('stores the last opened .sloom project path in the app user-data folder', async () => {
    const {
      buildStartupProjectStatePath,
      parseStartupProjectReopenPreference,
      parseStartupProjectState,
      serializeStartupProjectState,
    } = await loadStartupProjectModule();

    expect(buildStartupProjectStatePath('/tmp/signal-loom')).toBe('/tmp/signal-loom/startup-project.json');
    const defaultState = serializeStartupProjectState('/projects/issue-one.sloom');
    expect(parseStartupProjectState(defaultState)).toBe('/projects/issue-one.sloom');
    expect(parseStartupProjectReopenPreference(defaultState)).toBe(false);
    expect(parseStartupProjectReopenPreference(
      serializeStartupProjectState('/projects/issue-one.sloom', true),
    )).toBe(true);
  });

  it('retains a missing .sloom path for recovery while rejecting unrelated file types', async () => {
    const {
      parseStartupProjectReopenPreference,
      parseStartupProjectState,
      resolveStartupProjectPath,
    } = await loadStartupProjectModule();

    expect(parseStartupProjectState('not json')).toBeUndefined();
    expect(parseStartupProjectReopenPreference('not json')).toBe(false);
    expect(resolveStartupProjectPath('/projects/notes.txt', () => true)).toBeUndefined();
    expect(resolveStartupProjectPath('/projects/missing.sloom', () => false)).toBe('/projects/missing.sloom');
    expect(resolveStartupProjectPath('/projects/issue-one.sloom', () => true)).toBe('/projects/issue-one.sloom');
  });

  it('keeps normal startup blank unless reopening the last project was explicitly enabled', async () => {
    const { prepareRememberedStartupProject } = await loadStartupProjectModule();
    const readProject = vi.fn(async () => '{}');

    await expect(prepareRememberedStartupProject({
      filePath: '/projects/issue-one.sloom',
      reopenLastProjectOnStartup: false,
      readProject,
      parseProject: vi.fn(),
      prepareProject: vi.fn(),
    })).resolves.toEqual({ status: 'blank' });
    expect(readProject).not.toHaveBeenCalled();
  });

  it('preserves a temporarily unreadable path and offers discovered backups', async () => {
    const { prepareRememberedStartupProject } = await loadStartupProjectModule();
    const unavailable = Object.assign(new Error('The drive is temporarily unavailable.'), { code: 'EACCES' });
    const backups = [{ filePath: '/projects/issue-one.sloom.bak-2', modifiedAtMs: 2 }];
    const result = await prepareRememberedStartupProject({
      filePath: '/projects/issue-one.sloom',
      reopenLastProjectOnStartup: true,
      readProject: async () => { throw unavailable; },
      parseProject: vi.fn(),
      prepareProject: vi.fn(),
      discoverBackups: async () => backups,
    });

    expect(result).toEqual({
      status: 'recovery',
      recovery: {
        filePath: '/projects/issue-one.sloom',
        failure: { code: 'unreadable', message: 'The drive is temporarily unavailable.' },
        backups,
      },
    });
  });

  it.each([
    ['corrupt JSON', new Error('The selected project could not be parsed. Unexpected token.'), 'corrupt'],
    ['schema-invalid JSON', new Error('The selected file is not a valid Sloom Studio project.'), 'invalid-project'],
  ] as const)('reports %s without erasing the remembered path', async (_label, parseError, expectedCode) => {
    const { prepareRememberedStartupProject } = await loadStartupProjectModule();
    const result = await prepareRememberedStartupProject({
      filePath: '/projects/issue-one.sloom',
      reopenLastProjectOnStartup: true,
      readProject: async () => '{}',
      parseProject: () => { throw parseError; },
      prepareProject: vi.fn(),
      discoverBackups: async () => [],
    });

    expect(result.recovery).toMatchObject({
      filePath: '/projects/issue-one.sloom',
      failure: { code: expectedCode },
    });
  });

  it('can retry successfully after a temporary read failure', async () => {
    const { prepareRememberedStartupProject } = await loadStartupProjectModule();
    let attempt = 0;
    const options = {
      filePath: '/projects/issue-one.sloom',
      reopenLastProjectOnStartup: true,
      readProject: async () => {
        attempt += 1;
        if (attempt === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return '{"flow":{"nodes":[],"edges":[]}}';
      },
      parseProject: (contents: string) => JSON.parse(contents),
      prepareProject: async (filePath: string, document: unknown) => ({ filePath, document }),
      discoverBackups: async () => [],
    };

    await expect(prepareRememberedStartupProject(options)).resolves.toMatchObject({ status: 'recovery' });
    await expect(prepareRememberedStartupProject(options)).resolves.toEqual({
      status: 'project',
      prepared: {
        filePath: '/projects/issue-one.sloom',
        document: { flow: { nodes: [], edges: [] } },
      },
    });
  });

  it('discovers matching backup files newest-first and ignores other files', async () => {
    const { discoverStartupProjectBackups } = await loadStartupProjectModule();
    const modified: Record<string, number> = {
      '/projects/issue-one.sloom.bak-old': 1,
      '/projects/issue-one.sloom.bak-new': 9,
    };
    const backups = await discoverStartupProjectBackups('/projects/issue-one.sloom', {
      readdir: async () => [
        { name: 'issue-one.sloom.bak-old', isFile: () => true },
        { name: 'issue-one.sloom.bak-new', isFile: () => true },
        { name: 'other.sloom.bak-new', isFile: () => true },
        { name: 'issue-one.sloom.bak-folder', isFile: () => false },
      ],
      stat: async (filePath) => ({ mtimeMs: modified[filePath] ?? 0 }),
    });

    expect(backups.map((backup) => backup.filePath)).toEqual([
      '/projects/issue-one.sloom.bak-new',
      '/projects/issue-one.sloom.bak-old',
    ]);
  });

  it('scans backups sequentially and retains a bounded newest-first recovery list', async () => {
    const { MAX_STARTUP_PROJECT_BACKUPS, discoverStartupProjectBackups } = await loadStartupProjectModule();
    const entries = Array.from({ length: MAX_STARTUP_PROJECT_BACKUPS + 5 }, (_, index) => ({
      name: `issue-one.sloom.bak-${String(index).padStart(2, '0')}`,
      isFile: () => true,
    }));
    let index = 0;
    const read = vi.fn(async () => entries[index++] ?? null);
    const close = vi.fn(async () => undefined);
    const stat = vi.fn(async (filePath: string) => ({
      mtimeMs: Number(filePath.slice(filePath.lastIndexOf('-') + 1)),
    }));

    const backups = await discoverStartupProjectBackups('/projects/issue-one.sloom', {
      opendir: async () => ({ read, close }),
      stat,
    });

    expect(backups).toHaveLength(MAX_STARTUP_PROJECT_BACKUPS);
    expect(backups.map((backup) => backup.modifiedAtMs)).toEqual(
      Array.from({ length: MAX_STARTUP_PROJECT_BACKUPS }, (_, offset) => MAX_STARTUP_PROJECT_BACKUPS + 4 - offset),
    );
    expect(stat).toHaveBeenCalledTimes(MAX_STARTUP_PROJECT_BACKUPS + 5);
    expect(read).toHaveBeenCalledTimes(MAX_STARTUP_PROJECT_BACKUPS + 6);
    expect(close).toHaveBeenCalledOnce();
  });
});
