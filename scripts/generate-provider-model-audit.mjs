import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT = resolve(DEFAULT_ROOT, 'docs/audits/provider-model-audit-2026-07-14.md');
const CAPABILITIES = ['text', 'image', 'video', 'audio'];

export async function loadProviderModelAudit(root = DEFAULT_ROOT) {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const [textModule, imageModule, videoModule, audioModule, catalogModule] = await Promise.all([
      server.ssrLoadModule('/src/lib/modelContracts/textModelContracts.ts'),
      server.ssrLoadModule('/src/lib/modelContracts/imageModelContractAdapter.ts'),
      server.ssrLoadModule('/src/lib/modelContracts/videoModelContracts.ts'),
      server.ssrLoadModule('/src/lib/modelContracts/audioModelContracts.ts'),
      server.ssrLoadModule('/src/lib/providerCatalog.ts'),
    ]);
    const contractsByCapability = {
      text: textModule.TEXT_MODEL_CONTRACTS,
      image: imageModule.IMAGE_MODEL_CONTRACTS,
      video: videoModule.VIDEO_MODEL_CONTRACTS,
      audio: audioModule.AUDIO_MODEL_CONTRACTS,
    };
    const rows = CAPABILITIES.flatMap((capability) =>
      contractsByCapability[capability].map((contract) => rowFromContract(capability, contract))
    );
    const normalOptions = flattenNormalOptions(catalogModule.FALLBACK_MODEL_OPTIONS);
    const rowKeys = new Set(rows.map((row) => modelKey(row.capability, row.providerId, row.modelId)));
    const orphanNormalOptions = normalOptions.filter(
      (option) => !rowKeys.has(modelKey(option.capability, option.providerId, option.modelId)),
    );
    const normalKeys = new Set(normalOptions.map((option) => modelKey(option.capability, option.providerId, option.modelId)));
    const legacyOnly = rows.filter((row) => !normalKeys.has(modelKey(row.capability, row.providerId, row.modelId)));

    return {
      rows,
      normalOptions,
      orphanNormalOptions,
      legacyOnly,
      vestigialModelIds: [...catalogModule.VESTIGIAL_MODEL_IDS],
    };
  } finally {
    await server.close();
  }
}

export function renderProviderModelAudit(audit) {
  const rows = audit.rows.map((row) => [
    row.capability,
    row.providerId,
    `\`${row.modelId}\``,
    row.displayName,
    row.api,
    row.auth,
    row.inputOutput,
    row.operations,
    row.controls,
    `${row.lifecycle} / ${row.availability}`,
    row.warning,
    row.requestBuilder,
    row.evidence.map((entry) => `[${entry.title}](${entry.url}) (${entry.verifiedAt})`).join('<br>'),
    row.example,
  ].map(cell).join(' | '));
  const byCapability = Object.fromEntries(CAPABILITIES.map((capability) => [
    capability,
    audit.rows.filter((row) => row.capability === capability).length,
  ]));
  const legacyRows = audit.legacyOnly.map((row) =>
    `- ${row.capability} / ${row.providerId} / \`${row.modelId}\`: ${row.lifecycle}, ${row.availability}${row.migrationModelId ? `; migrate to \`${row.migrationModelId}\`` : ''}.`
  );

  return `# Provider and Model API Audit — 2026-07-14

> Generated from the shared provider/model contract registries and \`FALLBACK_MODEL_OPTIONS\` by \`scripts/generate-provider-model-audit.mjs\`. Do not hand-edit this matrix.

## Result

The catalog contains ${audit.rows.length} curated model contracts: ${byCapability.text} text, ${byCapability.image} image, ${byCapability.video} video, and ${byCapability.audio} audio. ${audit.normalOptions.length} entries appear in normal selection. Every normal option maps to a contract; a discovered model that is not curated remains selectable through a deliberately restricted, visibly unverified fallback contract.

Each row records the exact model ID, API family/endpoint, authentication route, input/output modalities, operations, exposed request fields and limits, lifecycle, account availability, request builder, official evidence, and a representative Flow chain. UI controls are derived from these parameter contracts. Unsupported controls stay visible where useful, explain why they are blocked, and are stripped/rejected by request validation before an API call.

## Exhaustive matrix

| Capability | Provider | Exact model ID | Display name | API family / endpoint | Auth | Inputs → outputs | Operations | Exposed controls / limits | Lifecycle / availability | Warning / limitation | Request builder | Official evidence | Representative Flow chain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row} |`).join('\n')}

## Catalog lifecycle changes

Normal selection excludes contracts that are shut down, unavailable, or superseded, but saved flows keep their exact string for diagnostics and migration:

${legacyRows.length > 0 ? legacyRows.join('\n') : '- None.'}

Discovery also filters provider-returned vestigial IDs from normal selection:

${audit.vestigialModelIds.map((id) => `- \`${id}\``).join('\n')}

Curated options are not deleted merely because an account's live \`/models\` response omits them. Live-only IDs are appended with an unverified lifecycle and the minimum safe endpoint controls. This separates provider documentation from account/region rollout while preserving the user's ability to design a flow before adding credentials.
`;
}

export async function generateProviderModelAudit({ root = DEFAULT_ROOT, output = DEFAULT_OUTPUT } = {}) {
  const audit = await loadProviderModelAudit(root);
  if (audit.orphanNormalOptions.length > 0) {
    throw new Error(`Normal model options without contracts: ${audit.orphanNormalOptions.map((row) => `${row.capability}/${row.providerId}/${row.modelId}`).join(', ')}`);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderProviderModelAudit(audit), 'utf8');
  return { output, count: audit.rows.length };
}

function rowFromContract(capability, contract) {
  return {
    capability,
    providerId: contract.providerId,
    modelId: contract.modelId,
    displayName: contract.displayName,
    api: `${contract.apiFamily}: ${contract.endpoint}`,
    auth: contract.auth.notes ? `${contract.auth.type} — ${contract.auth.notes}` : contract.auth.type,
    inputOutput: `${contract.inputModalities.join(', ')} → ${contract.outputModalities.join(', ')}`,
    operations: contract.operations.join(', '),
    controls: contract.parameters.length > 0
      ? contract.parameters.map(formatParameter).join('<br>')
      : 'No request controls declared',
    lifecycle: contract.lifecycle,
    availability: contract.availability,
    warning: contract.limitations.join(' '),
    requestBuilder: contract.requestBuilder,
    evidence: contract.evidence,
    example: contract.flowExample.summary,
    migrationModelId: contract.migrationModelId,
  };
}

function formatParameter(parameter) {
  const constraints = [];
  if (parameter.required) constraints.push('required');
  if (parameter.min !== undefined || parameter.max !== undefined) {
    constraints.push(`${parameter.min ?? '…'}–${parameter.max ?? '…'}${parameter.step !== undefined ? ` step ${parameter.step}` : ''}`);
  }
  if (parameter.minItems !== undefined || parameter.maxItems !== undefined) {
    constraints.push(`${parameter.minItems ?? 0}–${parameter.maxItems ?? 'many'} items`);
  }
  if (parameter.options?.length) {
    const values = parameter.options.map((option) => option.value);
    constraints.push(values.length > 8 ? `${values.slice(0, 8).join(', ')}… (${values.length} values)` : values.join(', '));
  }
  if (parameter.conditions?.operations?.length) constraints.push(`for ${parameter.conditions.operations.join(', ')}`);
  return `\`${parameter.id}\` → \`${parameter.apiName}\` (${parameter.type}${constraints.length ? `; ${constraints.join('; ')}` : ''})`;
}

function flattenNormalOptions(catalog) {
  return CAPABILITIES.flatMap((capability) =>
    Object.entries(catalog[capability]).flatMap(([providerId, options]) =>
      options.map((option) => ({
        capability,
        providerId,
        modelId: option.value,
        label: option.label,
      }))
    )
  );
}

function modelKey(capability, providerId, modelId) {
  return `${capability}:${providerId}:${modelId}`;
}

function cell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function isMain() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const result = await generateProviderModelAudit();
  console.log(`Generated ${result.count} provider/model audit rows at ${result.output}`);
}
