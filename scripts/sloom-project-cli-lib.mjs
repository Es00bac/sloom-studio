import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PROJECT_SCHEMA = require('../shared/project-schema.json');

export const PROJECT_CLI_RESULT_VERSION = 1;
export const PROJECT_CLI_ACTIONS = Object.freeze(['inspect', 'rename']);
export const PROJECT_CLI_MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export const PROJECT_CLI_MAX_FLOW_NODES = 10_000;
export const PROJECT_CLI_MAX_FLOW_EDGES = 20_000;

const PROJECT_CLI_MAX_WORKSPACES = 64;
const PROJECT_CLI_MAX_NAME_BYTES = 240;
const PROJECT_CLI_MAX_IDENTIFIER_BYTES = 256;
const PROJECT_CLI_LOCK_SUFFIX = '.sloom-cli.lock';
const PROJECT_NODE_TYPES = new Set(PROJECT_SCHEMA.flowNodeTypes);
const PROJECT_SCHEMA_VERSION = PROJECT_SCHEMA.schemaVersion;
const textEncoder = new TextEncoder();

const DEFAULT_FILE_SYSTEM = Object.freeze({
  copyFile,
  lstat,
  open,
  readFile,
  rename,
  unlink,
});

export class ProjectCliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProjectCliError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Parse the intentionally small public surface. No default project path, environment settings,
 * shell invocation, or arbitrary document patch are accepted.
 */
export function parseProjectCliArgs(argv) {
  const args = Array.from(argv ?? []);
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length === 0) {
    throw new ProjectCliError('invalid-argument', 'Choose an action: inspect or rename.');
  }

  const action = args.shift();
  if (!PROJECT_CLI_ACTIONS.includes(action)) {
    throw new ProjectCliError('unsupported-action', `Unsupported action "${String(action)}". Use inspect or rename.`);
  }

  const values = Object.create(null);
  const seenOptions = new Set();
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--dry-run') {
      if (seenOptions.has(option)) throw new ProjectCliError('invalid-argument', 'Duplicate option --dry-run.');
      seenOptions.add(option);
      dryRun = true;
      continue;
    }

    if (!['--project', '--name', '--expected-sha256'].includes(option)) {
      throw new ProjectCliError('invalid-argument', `Unknown option: ${String(option)}.`);
    }
    if (seenOptions.has(option)) throw new ProjectCliError('invalid-argument', `Duplicate option ${option}.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ProjectCliError('invalid-argument', `Missing value for ${option}.`);
    }
    seenOptions.add(option);
    values[option] = value;
    index += 1;
  }

  if (!values['--project']) {
    throw new ProjectCliError('invalid-argument', 'An explicit --project PATH is required.');
  }
  const projectPath = resolve(values['--project']);
  if (extname(projectPath).toLowerCase() !== '.sloom') {
    throw new ProjectCliError('invalid-project-path', '--project must name a .sloom file.');
  }

  if (action === 'inspect') {
    if (dryRun || values['--name'] || values['--expected-sha256']) {
      throw new ProjectCliError('invalid-argument', 'inspect accepts only --project PATH.');
    }
    return { action, projectPath, dryRun: false };
  }

  if (!values['--name']) {
    throw new ProjectCliError('invalid-argument', 'rename requires --name TEXT.');
  }
  if (!values['--expected-sha256']) {
    throw new ProjectCliError('precondition-required', 'rename requires the exact --expected-sha256 printed by inspect.');
  }
  const expectedSha256 = values['--expected-sha256'].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new ProjectCliError('invalid-argument', '--expected-sha256 must be a 64-character hexadecimal SHA-256 digest.');
  }

  return {
    action,
    projectPath,
    name: normalizeText(values['--name'], 'Project name', PROJECT_CLI_MAX_NAME_BYTES),
    expectedSha256,
    dryRun,
  };
}

export function formatProjectCliHelp() {
  return `Usage: node scripts/sloom-project-cli.mjs <action> --project PATH [options]

Declared local actions:
  inspect --project PATH
      Validate the bounded project spine and print a structured summary, including SHA-256.

  rename --project PATH --name TEXT --expected-sha256 DIGEST [--dry-run]
      Rename a project only when DIGEST matches inspect output. A sibling backup is created before
      an atomic write; --dry-run validates and reports the planned change without writing.

This local CLI never reads provider settings or credentials, runs no user-supplied code, and does
not provide a generic JSON patch surface.`;
}

/**
 * Execute an inspect or rename command and always return a structured result. The injected clock,
 * UUID supplier, and file-system facade are test seams; production uses the native defaults.
 */
export async function executeProjectCli(argv, options = {}) {
  let command;
  try {
    command = parseProjectCliArgs(argv);
    if (command.help) return { ok: true, help: true, version: PROJECT_CLI_RESULT_VERSION };

    const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...options.fileSystem };
    const source = await readProjectDocument(command.projectPath, fileSystem);
    const before = summarizeProjectDocument(source.document, command.projectPath, source);

    if (command.action === 'inspect') {
      return {
        ok: true,
        version: PROJECT_CLI_RESULT_VERSION,
        action: command.action,
        dryRun: false,
        validator: 'project-spine-v1',
        project: before,
      };
    }

    if (command.expectedSha256 !== source.sha256) {
      throw new ProjectCliError(
        'precondition-failed',
        'The project changed or the supplied SHA-256 is stale. Run inspect again before renaming.',
        { expectedSha256: command.expectedSha256, actualSha256: source.sha256 },
      );
    }

    if (source.document.name === command.name) {
      return {
        ok: true,
        version: PROJECT_CLI_RESULT_VERSION,
        action: command.action,
        dryRun: command.dryRun,
        validator: 'project-spine-v1',
        project: { before, after: before },
        write: { status: 'unchanged', backupPath: undefined },
      };
    }

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const plannedDocument = planProjectRename(source.document, command.name, now);
    const after = summarizeProjectDocument(plannedDocument, command.projectPath, {
      byteLength: Buffer.byteLength(serializeProjectDocument(plannedDocument)),
      sha256: undefined,
    });

    if (command.dryRun) {
      return {
        ok: true,
        version: PROJECT_CLI_RESULT_VERSION,
        action: command.action,
        dryRun: true,
        validator: 'project-spine-v1',
        project: { before, after },
        write: { status: 'planned', backupPath: undefined },
      };
    }

    const backupPath = await atomicallyWriteRenamedProject({
      command,
      source,
      plannedDocument,
      fileSystem,
      now,
      createId: options.createId ?? randomUUID,
    });
    const serialized = serializeProjectDocument(plannedDocument);
    return {
      ok: true,
      version: PROJECT_CLI_RESULT_VERSION,
      action: command.action,
      dryRun: false,
      validator: 'project-spine-v1',
      project: {
        before,
        after: { ...after, sha256: sha256(Buffer.from(serialized)), byteLength: Buffer.byteLength(serialized) },
      },
      write: { status: 'written', backupPath },
    };
  } catch (error) {
    return failureResult(command, error);
  }
}

export function exitCodeForProjectCliResult(result) {
  return result?.ok ? 0 : 1;
}

export function formatProjectCliResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function validateProjectSpine(document) {
  if (!isRecord(document)) {
    throw new ProjectCliError('invalid-project', 'The project root must be a JSON object.');
  }
  if (document.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectCliError(
      'unsupported-schema',
      `Expected project schema version ${PROJECT_SCHEMA_VERSION}.`,
    );
  }

  validateIdentifier(document.id, 'Project id');
  validateProjectText(document.name, 'Project name', PROJECT_CLI_MAX_NAME_BYTES);
  validateFiniteNumber(document.savedAt, 'Project savedAt');
  validateFlowSnapshot(document.flow, 'flow');

  if (document.flowWorkspaces === undefined) {
    if (document.activeFlowWorkspaceId !== undefined) {
      throw new ProjectCliError('invalid-project', 'activeFlowWorkspaceId requires flowWorkspaces.');
    }
    return {
      activeWorkspaceId: undefined,
      workspaceCount: 1,
      nodeCount: document.flow.nodes.length,
      edgeCount: document.flow.edges.length,
    };
  }

  if (!Array.isArray(document.flowWorkspaces)
    || document.flowWorkspaces.length === 0
    || document.flowWorkspaces.length > PROJECT_CLI_MAX_WORKSPACES) {
    throw new ProjectCliError('invalid-project', `flowWorkspaces must contain 1–${PROJECT_CLI_MAX_WORKSPACES} entries.`);
  }
  const workspaceIds = new Set();
  for (const [index, workspace] of document.flowWorkspaces.entries()) {
    if (!isRecord(workspace)) {
      throw new ProjectCliError('invalid-project', `flowWorkspaces[${index}] must be an object.`);
    }
    validateIdentifier(workspace.id, `flowWorkspaces[${index}].id`);
    if (workspaceIds.has(workspace.id)) {
      throw new ProjectCliError('invalid-project', `flowWorkspaces contains duplicate id "${workspace.id}".`);
    }
    workspaceIds.add(workspace.id);
    validateProjectText(workspace.name, `flowWorkspaces[${index}].name`, PROJECT_CLI_MAX_NAME_BYTES);
    validateFiniteNumber(workspace.createdAt, `flowWorkspaces[${index}].createdAt`);
    validateFiniteNumber(workspace.updatedAt, `flowWorkspaces[${index}].updatedAt`);
    validateFlowSnapshot(workspace.flow, `flowWorkspaces[${index}].flow`);
  }

  validateIdentifier(document.activeFlowWorkspaceId, 'activeFlowWorkspaceId');
  if (!workspaceIds.has(document.activeFlowWorkspaceId)) {
    throw new ProjectCliError('invalid-project', 'activeFlowWorkspaceId must identify an existing workspace.');
  }
  const activeWorkspace = document.flowWorkspaces.find((workspace) => workspace.id === document.activeFlowWorkspaceId);
  return {
    activeWorkspaceId: document.activeFlowWorkspaceId,
    workspaceCount: document.flowWorkspaces.length,
    nodeCount: activeWorkspace.flow.nodes.length,
    edgeCount: activeWorkspace.flow.edges.length,
  };
}

export function planProjectRename(document, name, savedAt) {
  const planned = structuredClone(document);
  planned.name = normalizeText(name, 'Project name', PROJECT_CLI_MAX_NAME_BYTES);
  planned.savedAt = savedAt;
  validateProjectSpine(planned);
  return planned;
}

function failureResult(command, error) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    version: PROJECT_CLI_RESULT_VERSION,
    action: command?.action,
    projectPath: command?.projectPath,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  };
}

function normalizeError(error) {
  if (error instanceof ProjectCliError) return error;
  if (error?.code === 'ENOENT') return new ProjectCliError('missing-project', 'The requested .sloom project does not exist.');
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new ProjectCliError('filesystem-denied', 'The CLI could not access the requested project path.');
  }
  return new ProjectCliError('operation-failed', error instanceof Error ? error.message : String(error));
}

async function readProjectDocument(projectPath, fileSystem) {
  const fileInfo = await assertRegularProjectFile(projectPath, fileSystem);
  let bytes;
  try {
    bytes = await fileSystem.readFile(projectPath);
  } catch (error) {
    throw normalizeError(error);
  }
  if (bytes.byteLength > PROJECT_CLI_MAX_PROJECT_BYTES) {
    throw new ProjectCliError('project-too-large', `Project exceeds the ${PROJECT_CLI_MAX_PROJECT_BYTES}-byte CLI safety limit.`);
  }

  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ProjectCliError('invalid-json', 'The project is not valid JSON.');
  }
  validateProjectSpine(document);
  return {
    document,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    fileMode: fileInfo.mode & 0o777,
  };
}

async function assertRegularProjectFile(projectPath, fileSystem) {
  let fileInfo;
  try {
    fileInfo = await fileSystem.lstat(projectPath);
  } catch (error) {
    throw normalizeError(error);
  }
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new ProjectCliError('invalid-project-path', '--project must resolve to a regular non-symlink .sloom file.');
  }
  if (fileInfo.size > PROJECT_CLI_MAX_PROJECT_BYTES) {
    throw new ProjectCliError('project-too-large', `Project exceeds the ${PROJECT_CLI_MAX_PROJECT_BYTES}-byte CLI safety limit.`);
  }
  return fileInfo;
}

function summarizeProjectDocument(document, projectPath, source) {
  const spine = validateProjectSpine(document);
  return {
    path: projectPath,
    sha256: source.sha256,
    byteLength: source.byteLength,
    schemaVersion: document.schemaVersion,
    id: document.id,
    name: document.name,
    savedAt: document.savedAt,
    activeWorkspaceId: spine.activeWorkspaceId,
    workspaceCount: spine.workspaceCount,
    nodeCount: spine.nodeCount,
    edgeCount: spine.edgeCount,
    sourceItemCount: countSourceItems(document.sourceBin),
    paperDocumentCount: countPaperDocuments(document.paper),
    imageDocumentCount: Array.isArray(document.imageEditor?.documents) ? document.imageEditor.documents.length : 0,
  };
}

function countSourceItems(sourceBin) {
  if (!isRecord(sourceBin) || !Array.isArray(sourceBin.bins)) return 0;
  return sourceBin.bins.reduce((count, bin) => count + (Array.isArray(bin?.items) ? bin.items.length : 0), 0);
}

function countPaperDocuments(paper) {
  if (!isRecord(paper)) return 0;
  return (paper.document ? 1 : 0) + (Array.isArray(paper.documents) ? paper.documents.length : 0);
}

async function atomicallyWriteRenamedProject({
  command,
  source,
  plannedDocument,
  fileSystem,
  now,
  createId,
}) {
  const lockPath = `${command.projectPath}${PROJECT_CLI_LOCK_SUFFIX}`;
  let lockHandle;
  let temporaryPath;
  let backupPath;
  try {
    try {
      lockHandle = await fileSystem.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new ProjectCliError('project-busy', `A CLI lock already exists for ${command.projectPath}.`);
      }
      throw normalizeError(error);
    }

    await assertUnchangedProject(command.projectPath, source.sha256, fileSystem);
    backupPath = buildBackupPath(command.projectPath, now, createId());
    try {
      await fileSystem.copyFile(command.projectPath, backupPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      throw new ProjectCliError('backup-failed', 'The original project could not be backed up; no project write was attempted.');
    }
    const backupBytes = await fileSystem.readFile(backupPath);
    if (sha256(backupBytes) !== source.sha256) {
      throw new ProjectCliError('backup-mismatch', 'The backup did not match the inspected project; no project write was attempted.', { backupPath });
    }

    await assertUnchangedProject(command.projectPath, source.sha256, fileSystem);
    const serialized = serializeProjectDocument(plannedDocument);
    temporaryPath = buildTemporaryPath(command.projectPath, createId());
    const temporaryHandle = await fileSystem.open(temporaryPath, 'wx', source.fileMode);
    try {
      await temporaryHandle.writeFile(serialized, 'utf8');
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await assertUnchangedProject(command.projectPath, source.sha256, fileSystem);
    await fileSystem.rename(temporaryPath, command.projectPath);
    temporaryPath = undefined;
    return backupPath;
  } finally {
    if (temporaryPath) await ignoreFailure(() => fileSystem.unlink(temporaryPath));
    if (lockHandle) await ignoreFailure(() => lockHandle.close());
    if (lockHandle) await ignoreFailure(() => fileSystem.unlink(lockPath));
  }
}

async function assertUnchangedProject(projectPath, expectedSha256, fileSystem) {
  const current = await readProjectDocument(projectPath, fileSystem);
  if (current.sha256 !== expectedSha256) {
    throw new ProjectCliError(
      'concurrent-change',
      'The project changed while the CLI was preparing its transaction. No project write was attempted.',
      { expectedSha256, actualSha256: current.sha256 },
    );
  }
}

function buildBackupPath(projectPath, now, id) {
  return `${projectPath}.bak-${compactTimestamp(now)}-${String(id)}`;
}

function buildTemporaryPath(projectPath, id) {
  return join(dirname(projectPath), `.${basename(projectPath)}.sloom-cli-${String(id)}.tmp`);
}

function serializeProjectDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function validateFlowSnapshot(flow, label) {
  if (!isRecord(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new ProjectCliError('invalid-project', `${label} must contain nodes and edges arrays.`);
  }
  if (flow.nodes.length > PROJECT_CLI_MAX_FLOW_NODES || flow.edges.length > PROJECT_CLI_MAX_FLOW_EDGES) {
    throw new ProjectCliError('project-too-large', `${label} exceeds the CLI graph safety limit.`);
  }

  const nodeIds = new Set();
  for (const [index, node] of flow.nodes.entries()) {
    if (!isRecord(node)) throw new ProjectCliError('invalid-project', `${label}.nodes[${index}] must be an object.`);
    validateIdentifier(node.id, `${label}.nodes[${index}].id`);
    if (nodeIds.has(node.id)) throw new ProjectCliError('invalid-project', `${label} contains duplicate node id "${node.id}".`);
    nodeIds.add(node.id);
    if (!PROJECT_NODE_TYPES.has(node.type)) {
      throw new ProjectCliError('invalid-project', `${label}.nodes[${index}] has unsupported type "${String(node.type)}".`);
    }
    if (!isRecord(node.position)) {
      throw new ProjectCliError('invalid-project', `${label}.nodes[${index}].position must be an object.`);
    }
    validateFiniteNumber(node.position.x, `${label}.nodes[${index}].position.x`);
    validateFiniteNumber(node.position.y, `${label}.nodes[${index}].position.y`);
    if (!isRecord(node.data)) {
      throw new ProjectCliError('invalid-project', `${label}.nodes[${index}].data must be an object.`);
    }
  }

  const edgeIds = new Set();
  for (const [index, edge] of flow.edges.entries()) {
    if (!isRecord(edge)) throw new ProjectCliError('invalid-project', `${label}.edges[${index}] must be an object.`);
    validateIdentifier(edge.id, `${label}.edges[${index}].id`);
    if (edgeIds.has(edge.id)) throw new ProjectCliError('invalid-project', `${label} contains duplicate edge id "${edge.id}".`);
    edgeIds.add(edge.id);
    validateIdentifier(edge.source, `${label}.edges[${index}].source`);
    validateIdentifier(edge.target, `${label}.edges[${index}].target`);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new ProjectCliError('invalid-project', `${label}.edges[${index}] references a missing node.`);
    }
  }
}

function validateIdentifier(value, label) {
  return validateProjectText(value, label, PROJECT_CLI_MAX_IDENTIFIER_BYTES);
}

function validateProjectText(value, label, maximumBytes) {
  try {
    return normalizeText(value, label, maximumBytes);
  } catch (error) {
    if (error instanceof ProjectCliError) {
      throw new ProjectCliError('invalid-project', error.message);
    }
    throw error;
  }
}

function validateFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectCliError('invalid-project', `${label} must be a finite number.`);
  }
  return value;
}

function normalizeText(value, label, maximumBytes) {
  if (typeof value !== 'string') throw new ProjectCliError('invalid-argument', `${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) throw new ProjectCliError('invalid-argument', `${label} must not be blank.`);
  if (textEncoder.encode(normalized).byteLength > maximumBytes) {
    throw new ProjectCliError('invalid-argument', `${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ProjectCliError('invalid-argument', `${label} contains a control character.`);
  }
  return normalized;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compactTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/\D/g, '').slice(0, 14);
}

async function ignoreFailure(operation) {
  try {
    await operation();
  } catch {
    // The caller is already returning the primary filesystem failure.
  }
}
