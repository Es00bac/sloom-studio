import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const REQUIRED_FILES = [
  'src/lib/providerPackContracts.ts',
  'src/lib/providerPackValidation.ts',
  'src/lib/providerPackPortability.ts',
  'src/lib/providerPackBackup.ts',
  'src/lib/providerPackRegistry.ts',
  'src/lib/providerCardLayout.ts',
  'src/lib/providerCardHandles.ts',
  'src/lib/providerDiscovery.ts',
  'src/lib/providerPackExecution.ts',
  'src/lib/providerCardFlow.ts',
  'src/lib/providerPackProject.ts',
  'src/lib/providerPackProjectSanitizer.ts',
  'src/lib/bundledProviderPacks.ts',
  'src/components/Nodes/AdaptiveModelCardNode.tsx',
  'src/components/Settings/ProviderPackLibrarySection.tsx',
  'src/components/Settings/ProviderPackLibrarySection.css',
  'docs/userguide/14-provider-packs-model-cards.md',
  'docs/provider-pack-author-reference.md',
  'docs/provider-pack-security-and-privacy.md',
  'docs/release/provider-pack-community-distribution.md',
];

const BUNDLED_PROVIDER_KEYS = [
  'android',
  'atlas',
  'bfl',
  'byteplus',
  'elevenlabs',
  'gemini',
  'huggingface',
  'localOpen',
  'openai',
  'stability',
];

export async function verifyProviderPacks({ root = DEFAULT_ROOT } = {}) {
  const errors = [];
  for (const path of REQUIRED_FILES) {
    try {
      await access(resolve(root, path), constants.R_OK);
    } catch {
      errors.push(`Missing provider-pack implementation or documentation: ${path}.`);
    }
  }

  const contracts = await safeRead(root, 'src/lib/providerPackContracts.ts');
  for (const marker of [
    'PROVIDER_PACK_SCHEMA_VERSION = 1',
    "PROVIDER_PACK_EXTENSION = '.sloom-provider.json'",
    'importBytes: 10 * 1024 * 1024',
    'cards: 2_000',
    'fieldsPerCard: 512',
    'operationsPerCard: 32',
    'CARD_WIDTH_MIN = 260',
    'CARD_WIDTH_MAX = 1_040',
    'ModelCardLayoutOverrideV1',
    'CardHandlePlacementV1',
    'ProviderPackReleasePolicyV1',
  ]) requireMarker(contracts, marker, 'provider-pack contracts', errors);

  const bundled = await safeRead(root, 'src/lib/bundledProviderPacks.ts');
  for (const id of BUNDLED_PROVIDER_KEYS) requireMarker(bundled, `${id}: {`, 'bundled provider packs', errors);
  requireMarker(bundled, 'maxItems: parameter.maxItems', 'Atlas reference pack', errors);
  requireMarker(bundled, "visiblePortCount: cardinality === 'many'", 'Atlas reference pack', errors);
  requireMarker(bundled, "'prompt', 'system-instruction', 'context', 'media-context', 'script'", 'single-port creative text fields', errors);
  const imageCapabilities = await safeRead(root, 'src/lib/imageProviderCapabilities.ts');
  requireMarker(imageCapabilities, 'maxReferenceImages: 14', 'Atlas reference capability source', errors);

  const validation = await safeRead(root, 'src/lib/providerPackValidation.ts');
  for (const marker of [
    'FORBIDDEN_IMPORT_KEYS',
    'credential-field',
    'unbounded-media-array',
    'missing-primary-extraction',
    'interactive-overlap',
    'required-hidden',
    'handle-collision',
    'validateReleasePolicy',
  ]) requireMarker(validation, marker, 'provider-pack validation', errors);

  const registry = await safeRead(root, 'src/lib/providerPackRegistry.ts');
  for (const marker of [
    'executionApproved',
    'Project-embedded packs render safely',
    'exportSettingsBackup',
    'sanitizePresentationOverride',
    'trustApprovedOrigins',
  ]) requireMarker(registry, marker, 'provider-pack registry', errors);

  const backup = await safeRead(root, 'src/lib/providerPackBackup.ts');
  for (const marker of [
    'sanitizeProviderPackSettingsBackup',
    'sanitizePresentationOverride',
    'backup data exceeds its safety limit',
  ]) requireMarker(backup, marker, 'provider-pack backup isolation', errors);

  const execution = await safeRead(root, 'src/lib/providerPackExecution.ts');
  for (const marker of [
    'executeProviderPackCard',
    'materializeSse',
    'executeSubmitPoll',
    "redirect: 'manual'",
    'providerPackRequest',
  ]) requireMarker(execution, marker, 'provider-pack execution', errors);

  const electron = await safeRead(root, 'electron/main.mjs');
  for (const marker of [
    "signal-loom:provider-pack-request",
    "redirect: 'error'",
    'url.origin !== approvedOrigin',
    'providerPackRequestControllers',
  ]) requireMarker(electron, marker, 'native provider broker', errors);

  const library = await safeRead(root, 'src/components/Settings/ProviderPackLibrarySection.tsx');
  for (const marker of [
    'Connect → Discover → Design → Test → Activate',
    'Auto Arrange',
    'Advanced — optional',
    'Run optional live test',
    'Save draft',
    'Approve origins &amp; activate',
    'data-model-card-builder-wysiwyg',
    'MODEL_CARD_ELEMENT_DRAG_TYPE',
    'data-handle-layout-inspector',
  ]) requireMarker(library, marker, 'provider library and builder', errors);

  const adaptive = await safeRead(root, 'src/components/Nodes/AdaptiveModelCardNode.tsx');
  for (const marker of [
    'resolveCardLayout',
    'migrateModelCardOperationEdges',
    'CARD_WIDTH_PRESETS',
    'reference-gallery',
    'ImageMaskPainterDialog',
    'export function ModelFieldControl',
    'ElementFlowHandles',
  ]) requireMarker(adaptive, marker, 'adaptive card renderer', errors);

  const project = [
    await safeRead(root, 'src/lib/providerPackProject.ts'),
    await safeRead(root, 'src/lib/providerPackProjectSanitizer.ts'),
  ].join('\n');
  const projectValidation = await safeRead(root, 'src/lib/projectValidation.ts');
  const settings = await safeRead(root, 'src/store/settingsStore.ts');
  requireMarker(project, 'contentHash', 'project pack snapshots', errors);
  requireMarker(projectValidation, 'sanitizeModelCardLayoutOverride', 'project pack snapshots', errors);
  requireMarker(settings, 'providerPacks', 'encrypted settings backup', errors);

  const release = await safeRead(root, 'src/lib/providerPackReleaseMetadata.ts');
  for (const marker of [
    'forumCategoryUrl',
    'githubDiscussionsCategoryUrl',
    'Community-tested',
    'Needs update',
    'Security advisory',
  ]) requireMarker(release, marker, 'provider-pack release metadata', errors);

  return { errors, bundledPackCount: BUNDLED_PROVIDER_KEYS.length };
}

async function safeRead(root, path) {
  try {
    return await readFile(resolve(root, path), 'utf8');
  } catch {
    return '';
  }
}

function requireMarker(source, marker, label, errors) {
  if (!source.includes(marker)) errors.push(`${label} is missing required evidence: ${marker}.`);
}

function isMain() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const result = await verifyProviderPacks();
  if (result.errors.length) {
    console.error('Provider-pack production audit failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Provider-pack production audit passed: ${result.bundledPackCount} portable bundled provider packs.`);
  }
}
