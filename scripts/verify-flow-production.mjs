import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadFlowNodeAuditRows,
  renderFlowNodeAudit,
} from './generate-flow-node-audit.mjs';
import {
  loadProviderModelAudit,
  renderProviderModelAudit,
} from './generate-provider-model-audit.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const REQUIRED_IMPLEMENTATION_FILES = [
  'src/lib/flowPortTypes.ts',
  'src/lib/flowNodeContracts.ts',
  'src/lib/flowConnectionContracts.ts',
  'src/lib/flowRuntimePortCapabilities.ts',
  'src/components/Flow/TypedFlowEdge.tsx',
  'src/components/Flow/TypedConnectionLine.tsx',
  'src/components/Nodes/TypedHandle.tsx',
  'src/lib/providerModelContracts.ts',
  'src/lib/modelContracts/textModelContracts.ts',
  'src/lib/modelContracts/imageModelContractAdapter.ts',
  'src/lib/modelContracts/videoModelContracts.ts',
  'src/lib/modelContracts/audioModelContracts.ts',
  'electron/vertex-auth.cjs',
  'src/components/Settings/VertexAuthPanel.tsx',
  'src/lib/vertex/vertexServiceAccountAuth.ts',
  'src/lib/vertexDirectRest.ts',
];

export async function verifyFlowProduction({ root = DEFAULT_ROOT } = {}) {
  const errors = [];
  const nodeRows = await loadFlowNodeAuditRows(root);
  const modelAudit = await loadProviderModelAudit(root);

  if (nodeRows.length !== 65) errors.push(`Expected 65 Flow node contracts; found ${nodeRows.length}.`);
  const missingNodeFields = nodeRows.filter((row) =>
    !row.purpose || !row.inputs || !row.outputs || !row.example || !row.implementation
  );
  if (missingNodeFields.length) {
    errors.push(`Incomplete node audit rows: ${missingNodeFields.map((row) => row.type).join(', ')}.`);
  }
  const missingRuntimeEvidence = nodeRows.filter((row) => row.missingRuntimeEvidence.length > 0);
  if (missingRuntimeEvidence.length) {
    errors.push(`Input ports without runtime evidence: ${missingRuntimeEvidence.map((row) => `${row.type}(${row.missingRuntimeEvidence.join(', ')})`).join(', ')}.`);
  }

  for (const row of nodeRows) {
    await requireFile(resolve(root, row.implementation), errors, `Node implementation for ${row.type}`);
    for (const evidencePath of row.runtimeEvidenceFiles) {
      await requireFile(resolve(root, evidencePath), errors, `Runtime evidence for ${row.type}`);
    }
  }
  for (const path of REQUIRED_IMPLEMENTATION_FILES) {
    await requireFile(resolve(root, path), errors, 'Required Flow audit implementation');
  }

  if (modelAudit.orphanNormalOptions.length) {
    errors.push(`Normal selectable models without contracts: ${modelAudit.orphanNormalOptions.map((option) => `${option.capability}/${option.providerId}/${option.modelId}`).join(', ')}.`);
  }
  const missingEvidence = modelAudit.rows.filter((row) => row.lifecycle !== 'unverified' && row.evidence.length === 0);
  if (missingEvidence.length) {
    errors.push(`Verified models without official evidence: ${missingEvidence.map((row) => `${row.providerId}/${row.modelId}`).join(', ')}.`);
  }
  const normalIds = new Set(modelAudit.normalOptions.map((option) => option.modelId));
  const returnedVestigial = modelAudit.vestigialModelIds.filter((id) => normalIds.has(id));
  if (returnedVestigial.length) errors.push(`Vestigial model IDs returned to normal selection: ${returnedVestigial.join(', ')}.`);

  await compareGeneratedArtifact(
    resolve(root, 'docs/audits/flow-node-audit-2026-07-15.md'),
    renderFlowNodeAudit(nodeRows),
    errors,
  );
  await compareGeneratedArtifact(
    resolve(root, 'docs/audits/provider-model-audit-2026-07-14.md'),
    renderProviderModelAudit(modelAudit),
    errors,
  );

  const settingsSource = await readFile(resolve(root, 'src/store/settingsStore.ts'), 'utf8');
  const encryptsSerializedSettings = /encryptSecret\(JSON\.stringify\((?:next|winner)\)\)/.test(settingsSource);
  const rejectsPlaintextSettingsWrite = !/store\.setItem\(name,\s*JSON\.stringify\(/.test(settingsSource);
  if (!encryptsSerializedSettings || !rejectsPlaintextSettingsWrite) {
    errors.push('Settings persistence no longer proves encrypted serialization before durable storage.');
  }
  const projectSchema = await readFile(resolve(root, 'shared/project-schema.json'), 'utf8');
  if (projectSchema.includes('vertexServiceAccountJson')) {
    errors.push('Long-lived Vertex credential JSON must not be part of saved project files.');
  }

  const vertexGuidePath = resolve(root, 'docs/vertex-authentication.md');
  await requireFile(vertexGuidePath, errors, 'Vertex authentication guide');
  try {
    const vertexGuide = await readFile(vertexGuidePath, 'utf8');
    for (const requiredText of [
      'Windows desktop',
      'macOS desktop',
      'Linux desktop',
      'Android',
      'https://cloud.google.com/docs/authentication/application-default-credentials',
      'https://cloud.google.com/vertex-ai/docs/start/cloud-environment',
    ]) {
      if (!vertexGuide.includes(requiredText)) errors.push(`Vertex authentication guide is missing ${requiredText}.`);
    }
  } catch {
    // Missing-file error was already recorded above.
  }

  const leak = await scanCredentialLeaks(root);
  if (leak) errors.push(leak);

  return {
    errors,
    nodeCount: nodeRows.length,
    modelCount: modelAudit.rows.length,
    normalModelCount: modelAudit.normalOptions.length,
  };
}

export function findCredentialLeak(source) {
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]{12,}/.test(source)) {
    return 'credential-shaped private key literal';
  }
  const assignedSecret = /(?:refresh_token|client_secret|private_key)\s*[:=]\s*['"`]([^'"`\n]{20,})['"`]/gi;
  for (const match of source.matchAll(assignedSecret)) {
    const value = match[1].trim();
    if (!value || value.includes('…') || value.includes('<') || value.includes('fixture-')) continue;
    return `credential-shaped ${match[0].split(/\s*[:=]/)[0]} literal`;
  }
  return undefined;
}

async function compareGeneratedArtifact(path, expected, errors) {
  let actual;
  try {
    actual = await readFile(path, 'utf8');
  } catch {
    errors.push(`Missing generated audit artifact: ${relative(DEFAULT_ROOT, path)}.`);
    return;
  }
  if (actual !== expected) {
    errors.push(`Generated audit artifact is stale: ${relative(DEFAULT_ROOT, path)}. Run its generator.`);
  }
}

async function requireFile(path, errors, label) {
  try {
    await access(path, constants.R_OK);
  } catch {
    errors.push(`${label} is missing: ${relative(DEFAULT_ROOT, path)}.`);
  }
}

async function scanCredentialLeaks(root) {
  for (const base of ['src', 'electron', 'android']) {
    for (const path of await walk(resolve(root, base))) {
      const relativePath = relative(root, path);
      if (/\.(?:test|spec)\./.test(path) || relativePath.includes('/fixtures/')) continue;
      if (!/\.(?:ts|tsx|js|mjs|cjs|java)$/.test(path)) continue;
      const leak = findCredentialLeak(await readFile(path, 'utf8'));
      if (leak) return `${leak} found in ${relativePath}.`;
    }
  }
  return undefined;
}

async function walk(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = await Promise.all(entries.map((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }));
  return children.flat();
}

function isMain() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const result = await verifyFlowProduction();
  if (result.errors.length) {
    console.error('Flow production audit failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Flow production audit passed: ${result.nodeCount} nodes, ${result.modelCount} model contracts, ${result.normalModelCount} normal model options.`);
  }
}
