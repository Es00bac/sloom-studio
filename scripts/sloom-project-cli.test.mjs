import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  executeProjectCli,
  parseProjectCliArgs,
  PROJECT_CLI_RESULT_VERSION,
} from './sloom-project-cli-lib.mjs';

const execFile = promisify(execFileCallback);
const CLI_PATH = new URL('./sloom-project-cli.mjs', import.meta.url).pathname;
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Sloom project CLI', () => {
  it('requires a declared action, explicit project path, and SHA precondition for a write', () => {
    expect(() => parseProjectCliArgs([])).toThrow(/Choose an action/);
    expect(() => parseProjectCliArgs(['inspect'])).toThrow(/explicit --project/);
    expect(() => parseProjectCliArgs(['rename', '--project', '/tmp/demo.sloom', '--name', 'Renamed'])).toThrow(/expected-sha256/);
    expect(() => parseProjectCliArgs(['inspect', '--project', '/tmp/demo.sloom', '--dry-run'])).toThrow(/accepts only/);
    expect(() => parseProjectCliArgs(['patch', '--project', '/tmp/demo.sloom'])).toThrow(/Unsupported action/);
  });

  it('inspects a valid current project without writing and returns a bounded structured summary', async () => {
    const { projectPath, original } = await writeFixtureProject();

    const result = await executeProjectCli(['inspect', '--project', projectPath]);

    expect(result).toMatchObject({
      ok: true,
      version: PROJECT_CLI_RESULT_VERSION,
      action: 'inspect',
      validator: 'project-spine-v1',
      project: {
        path: projectPath,
        name: 'Original project',
        nodeCount: 1,
        edgeCount: 0,
        workspaceCount: 1,
        sourceItemCount: 2,
        paperDocumentCount: 1,
        imageDocumentCount: 1,
      },
    });
    expect(result.project.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(projectPath, 'utf8')).toBe(original);
    expect(await siblingArtifacts(projectPath)).toEqual([]);
  });

  it('inspects a legacy single-flow project without inventing a workspace', async () => {
    const fixture = await writeFixtureProject();
    const legacy = structuredClone(fixture.project);
    delete legacy.flowWorkspaces;
    delete legacy.activeFlowWorkspaceId;
    await writeFile(fixture.projectPath, `${JSON.stringify(legacy, null, 2)}\n`);

    const result = await executeProjectCli(['inspect', '--project', fixture.projectPath]);

    expect(result).toMatchObject({
      ok: true,
      action: 'inspect',
      project: { workspaceCount: 1, activeWorkspaceId: undefined, nodeCount: 1 },
    });
  });

  it('fails closed for malformed JSON, an unsupported schema, unknown node types, and edges with missing endpoints', async () => {
    const malformed = await writeFixtureText('{not valid json');
    const malformedResult = await executeProjectCli(['inspect', '--project', malformed.projectPath]);
    expect(malformedResult).toMatchObject({ ok: false, error: { code: 'invalid-json' } });
    expect(await readFile(malformed.projectPath, 'utf8')).toBe(malformed.original);

    const unsupportedSchema = await writeFixtureProject({ schemaVersion: 999 });
    const unsupportedSchemaResult = await executeProjectCli(['inspect', '--project', unsupportedSchema.projectPath]);
    expect(unsupportedSchemaResult).toMatchObject({ ok: false, error: { code: 'unsupported-schema' } });

    const unknownNode = await writeFixtureProject({
      flow: flowSnapshot([{ id: 'bad', type: 'not-a-sloom-node', position: { x: 0, y: 0 }, data: {} }]),
    });
    const unknownNodeResult = await executeProjectCli(['inspect', '--project', unknownNode.projectPath]);
    expect(unknownNodeResult).toMatchObject({ ok: false, error: { code: 'invalid-project' } });

    const missingEndpoint = await writeFixtureProject({
      flow: flowSnapshot(undefined, [{ id: 'edge-1', source: 'text-1', target: 'missing' }]),
    });
    const missingEndpointResult = await executeProjectCli(['inspect', '--project', missingEndpoint.projectPath]);
    expect(missingEndpointResult).toMatchObject({ ok: false, error: { code: 'invalid-project' } });
  });

  it('plans a rename without creating a backup, temp file, or project mutation during dry-run', async () => {
    const { projectPath, original } = await writeFixtureProject();
    const inspected = await executeProjectCli(['inspect', '--project', projectPath]);

    const result = await executeProjectCli([
      'rename', '--project', projectPath, '--name', 'Dry-run name', '--expected-sha256', inspected.project.sha256, '--dry-run',
    ], { now: 5000 });

    expect(result).toMatchObject({
      ok: true,
      action: 'rename',
      dryRun: true,
      project: { before: { name: 'Original project' }, after: { name: 'Dry-run name', savedAt: 5000 } },
      write: { status: 'planned' },
    });
    expect(await readFile(projectPath, 'utf8')).toBe(original);
    expect(await siblingArtifacts(projectPath)).toEqual([]);
  });

  it('treats a same-name request as a no-op without rewriting savedAt or creating a backup', async () => {
    const { projectPath, original } = await writeFixtureProject();
    const inspected = await executeProjectCli(['inspect', '--project', projectPath]);

    const result = await executeProjectCli([
      'rename', '--project', projectPath, '--name', 'Original project', '--expected-sha256', inspected.project.sha256,
    ], { now: 9999 });

    expect(result).toMatchObject({ ok: true, action: 'rename', write: { status: 'unchanged' } });
    expect(await readFile(projectPath, 'utf8')).toBe(original);
    expect(await siblingArtifacts(projectPath)).toEqual([]);
  });

  it('renames only after an exact precondition, preserves unrelated sections, and creates an exact backup', async () => {
    const fixture = await writeFixtureProject();
    const inspected = await executeProjectCli(['inspect', '--project', fixture.projectPath]);

    const result = await executeProjectCli([
      'rename', '--project', fixture.projectPath, '--name', 'Renamed project', '--expected-sha256', inspected.project.sha256,
    ], {
      now: 12_345,
      createId: () => 'test-transaction',
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'rename',
      dryRun: false,
      write: {
        status: 'written',
        backupPath: `${fixture.projectPath}.bak-19700101000012-test-transaction`,
      },
      project: {
        before: { name: 'Original project' },
        after: { name: 'Renamed project', savedAt: 12_345 },
      },
    });

    const updated = JSON.parse(await readFile(fixture.projectPath, 'utf8'));
    expect(updated).toMatchObject({
      name: 'Renamed project',
      savedAt: 12_345,
      unownedSection: fixture.project.unownedSection,
      sourceBin: fixture.project.sourceBin,
      paper: fixture.project.paper,
      imageEditor: fixture.project.imageEditor,
    });
    expect(await readFile(result.write.backupPath, 'utf8')).toBe(fixture.original);
    expect(await siblingArtifacts(fixture.projectPath)).toEqual([
      `${result.write.backupPath.split('/').at(-1)}`,
    ]);
  });

  it('refuses a stale SHA or active CLI lock before it creates a backup or overwrites the project', async () => {
    const fixture = await writeFixtureProject();
    const staleResult = await executeProjectCli([
      'rename', '--project', fixture.projectPath, '--name', 'Unsafe rename', '--expected-sha256', '0'.repeat(64),
    ]);
    expect(staleResult).toMatchObject({ ok: false, error: { code: 'precondition-failed' } });
    expect(await readFile(fixture.projectPath, 'utf8')).toBe(fixture.original);
    expect(await siblingArtifacts(fixture.projectPath)).toEqual([]);

    const inspected = await executeProjectCli(['inspect', '--project', fixture.projectPath]);
    await writeFile(`${fixture.projectPath}.sloom-cli.lock`, 'busy');
    const lockedResult = await executeProjectCli([
      'rename', '--project', fixture.projectPath, '--name', 'Locked rename', '--expected-sha256', inspected.project.sha256,
    ]);
    expect(lockedResult).toMatchObject({ ok: false, error: { code: 'project-busy' } });
    expect(await readFile(fixture.projectPath, 'utf8')).toBe(fixture.original);
    expect(await siblingArtifacts(fixture.projectPath)).toEqual(['fixture.sloom.sloom-cli.lock']);
  });

  it('runs the public entrypoint as JSON-only local automation', async () => {
    const fixture = await writeFixtureProject();

    const inspection = await execFile(process.execPath, [CLI_PATH, 'inspect', '--project', fixture.projectPath]);
    const inspected = JSON.parse(inspection.stdout);
    expect(inspection.stderr).toBe('');
    expect(inspected).toMatchObject({ ok: true, action: 'inspect', project: { name: 'Original project' } });

    const renamed = await execFile(process.execPath, [
      CLI_PATH,
      'rename',
      '--project',
      fixture.projectPath,
      '--name',
      'Subprocess rename',
      '--expected-sha256',
      inspected.project.sha256,
    ]);
    expect(renamed.stderr).toBe('');
    expect(JSON.parse(renamed.stdout)).toMatchObject({ ok: true, action: 'rename', write: { status: 'written' } });
    expect(JSON.parse(await readFile(fixture.projectPath, 'utf8'))).toMatchObject({ name: 'Subprocess rename' });
  });

  it('keeps the project untouched when the backup operation fails', async () => {
    const fixture = await writeFixtureProject();
    const inspected = await executeProjectCli(['inspect', '--project', fixture.projectPath]);
    const result = await executeProjectCli([
      'rename', '--project', fixture.projectPath, '--name', 'No backup write', '--expected-sha256', inspected.project.sha256,
    ], {
      fileSystem: {
        copyFile: async () => {
          const error = new Error('simulated backup failure');
          error.code = 'EIO';
          throw error;
        },
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'backup-failed' } });
    expect(await readFile(fixture.projectPath, 'utf8')).toBe(fixture.original);
    expect(await siblingArtifacts(fixture.projectPath)).toEqual([]);
  });

  it('cleans its temporary file and lock if staging the post-backup write fails', async () => {
    const fixture = await writeFixtureProject();
    const inspected = await executeProjectCli(['inspect', '--project', fixture.projectPath]);
    let openCount = 0;
    const result = await executeProjectCli([
      'rename', '--project', fixture.projectPath, '--name', 'No staged write', '--expected-sha256', inspected.project.sha256,
    ], {
      now: 12_345,
      createId: () => 'stage-failure',
      fileSystem: {
        open: async (...args) => {
          openCount += 1;
          if (openCount === 2) {
            const error = new Error('simulated staging failure');
            error.code = 'EIO';
            throw error;
          }
          return open(...args);
        },
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'operation-failed' } });
    expect(await readFile(fixture.projectPath, 'utf8')).toBe(fixture.original);
    expect(await siblingArtifacts(fixture.projectPath)).toEqual([
      'fixture.sloom.bak-19700101000012-stage-failure',
    ]);
  });
});

async function writeFixtureProject(overrides = {}) {
  const project = buildFixtureProject(overrides);
  return writeFixtureText(`${JSON.stringify(project, null, 2)}\n`, project);
}

async function writeFixtureText(contents, project = undefined) {
  const directory = await mkdtemp(join(tmpdir(), 'sloom-project-cli-'));
  temporaryDirectories.push(directory);
  const projectPath = join(directory, 'fixture.sloom');
  await writeFile(projectPath, contents);
  return { directory, projectPath, original: contents, project };
}

function buildFixtureProject(overrides) {
  const flow = overrides.flow ?? flowSnapshot();
  return {
    schemaVersion: 1,
    id: 'fixture-project',
    name: 'Original project',
    savedAt: 1,
    flow,
    flowWorkspaces: [{
      id: 'main',
      name: 'Main Flow',
      createdAt: 1,
      updatedAt: 1,
      flow: structuredClone(flow),
    }],
    activeFlowWorkspaceId: 'main',
    sourceBin: {
      bins: [{
        id: 'source-bin',
        items: [{ id: 'asset-1' }, { id: 'asset-2' }],
      }],
    },
    paper: { document: { id: 'paper-one' } },
    imageEditor: { documents: [{ id: 'image-one' }] },
    unownedSection: {
      preserves: ['future-field', { nested: true }],
    },
    ...overrides,
  };
}

function flowSnapshot(nodes = undefined, edges = undefined) {
  return {
    version: 3,
    nodes: nodes ?? [{
      id: 'text-1',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: { prompt: 'hello' },
    }],
    edges: edges ?? [],
  };
}

async function siblingArtifacts(projectPath) {
  const directory = projectPath.slice(0, projectPath.lastIndexOf('/'));
  const projectName = projectPath.slice(projectPath.lastIndexOf('/') + 1);
  const entries = await readdir(directory);
  return entries.filter((entry) => entry !== projectName).sort();
}
