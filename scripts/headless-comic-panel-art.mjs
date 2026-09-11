#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildComicPanelPrompt,
  buildGeneratedPanelFileTarget,
  buildProjectVisualReferenceIndex,
  buildPanelAssetFileName,
  collectUsableComicPanelSourceKeys,
  createGeneratedSourceBinItem,
  extractReferenceSections,
  parsePromptOverrides,
  parseComicIssueScript,
  selectVisualReferencesForTarget,
  upsertGeneratedSourceBinItems,
} from './comic-panel-art-lib.mjs';

const DEFAULT_PROJECT_PATH = '/home/cabewse/Documents/Loom Workspace/Comic Book/Issue 1.sloom';
const DEFAULT_ISSUE_DIR = '/mnt/xtra/OpenCAS/workspace/novels/writing-project-20260518-004126/comic_adaptation/issue_01';
const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_GEMINI_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_OPENAI_MODEL = 'gpt-image-1';
const DEFAULT_VERTEX_PROJECT_ID = 'gen-lang-client-0529114074';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_PROMPT_OVERRIDES_FILE = 'panel_art_prompt_overrides.md';
const IMAGE_GENERATION_RETRY_DELAYS_MS = [2500, 7500];
const execFileAsync = promisify(execFile);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectPath = resolve(options.project ?? DEFAULT_PROJECT_PATH);
  const issueDir = resolve(options.issueDir ?? DEFAULT_ISSUE_DIR);
  const scratchDirectory = resolve(options.scratchDirectory ?? defaultScratchDirectory(projectPath));
  const manifestPath = resolve(options.manifest ?? join(issueDir, 'headless_panel_art_manifest.json'));
  const promptOverridesPath = resolve(options.promptOverrides ?? join(issueDir, DEFAULT_PROMPT_OVERRIDES_FILE));
  const visualReferenceMapPath = resolve(options.visualReferenceMap ?? join(issueDir, 'visual_reference_map.json'));
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const model = options.model ?? (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_GEMINI_MODEL);

  const [scriptText, characterText, environmentText, productionNotesText, nameRepairText, projectText] = await Promise.all([
    readFile(join(issueDir, 'script.md'), 'utf8'),
    readFile(join(issueDir, 'character_descriptions.md'), 'utf8'),
    readFile(join(issueDir, 'environment_descriptions.md'), 'utf8'),
    readOptionalText(join(issueDir, 'production_notes.md')),
    readOptionalText(join(issueDir, 'name_repair.md')),
    readFile(projectPath, 'utf8'),
  ]);
  await ensurePromptOverridesFile(promptOverridesPath);
  const promptOverridesText = await readOptionalText(promptOverridesPath);
  const project = JSON.parse(projectText);
  const characters = extractReferenceSections(characterText, /^##\s+(C\d+)\s+—\s+(.+)$/gm);
  const environments = extractReferenceSections(environmentText, /^##\s+(ENV\s+E\d+)\s+—\s+(.+)$/gm);
  const promptOverrides = parsePromptOverrides(promptOverridesText ?? '');
  const issueContext = joinContextBlocks([
    ['Production notes', productionNotesText],
    ['Canonical name and term repair', nameRepairText],
  ]);
  const lockedVisualReferences = options.visualReferences
    ? await loadOrCreateVisualReferenceMap(visualReferenceMapPath, buildProjectVisualReferenceIndex(project), {
      refresh: options.refreshVisualReferenceMap,
      projectPath,
      scratchDirectory,
    })
    : undefined;
  let referenceIndex = applyLockedVisualReferences(buildProjectVisualReferenceIndex(project), lockedVisualReferences);
  const existingComicItems = collectExistingComicPanelItems(project);
  const existingKeys = collectExistingSourceKeys(project);
  const existingUsableComicKeys = collectUsableComicPanelSourceKeys(project, {
    scratchDirectory,
    getFileSize: getExistingFileSize,
  });
  const requestedKeys = options.only ? new Set(options.only.split(',').map((key) => key.trim()).filter(Boolean)) : undefined;
  const allTargets = parseComicIssueScript(scriptText);
  const targets = allTargets
    .filter((target) => !requestedKeys || requestedKeys.has(target.key))
    .filter((target) => {
      if (options.force || options.restyleExisting) return true;
      const sourceKey = `comic-panel:issue-01:${target.key}`;
      return !existingKeys.has(sourceKey) || !existingUsableComicKeys.has(sourceKey);
    });
  const limitedTargets = typeof options.limit === 'number' ? targets.slice(0, options.limit) : targets;

  const plan = limitedTargets.map((target) => ({
    key: target.key,
    label: target.label,
    aspectRatio: target.aspectRatio,
    characterIds: target.characterIds,
    environmentIds: target.environmentIds,
    visualReferences: options.visualReferences
      ? selectPanelVisualReferences(target, referenceIndex, allTargets, existingComicItems, options).map(referenceToManifest)
      : [],
    prompt: buildGenerationPrompt(target, { characters, environments }, {
      issueContext,
      promptOverrides,
      restyleExisting: options.restyleExisting,
    }),
  }));

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({
    projectPath,
    issueDir,
    scratchDirectory,
    promptOverridesPath,
    visualReferenceMapPath: options.visualReferences ? visualReferenceMapPath : undefined,
    provider,
    model,
    dryRun: Boolean(options.dryRun),
    targetCount: plan.length,
    skippedExistingCount: targets.length - limitedTargets.length,
    generatedAt: new Date().toISOString(),
    targets: plan,
  }, null, 2)}\n`);

  if (options.dryRun) {
    console.log(`Planned ${plan.length} panel-art generation target(s). Manifest: ${manifestPath}`);
    return;
  }

  const apiKey = provider === 'vertex' ? 'vertex-adc' : await resolveApiKey(provider, options);
  if (provider !== 'vertex' && !apiKey) {
    throw new Error(`No ${provider} API key found. Set GEMINI_API_KEY/GOOGLE_API_KEY or OPENAI_API_KEY, pass --api-key-file, or keep Signal Loom settings populated and use --use-signal-loom-settings.`);
  }

  await mkdir(scratchDirectory, { recursive: true });
  let workingProject = project;
  let updatedCount = 0;
  const backupPath = `${projectPath}.bak-${compactTimestamp()}`;
  await copyFile(projectPath, backupPath);
  console.log(`Backup written to ${backupPath}`);

  for (let index = 0; index < limitedTargets.length; index += 1) {
    const target = limitedTargets[index];
    const prompt = plan[index].prompt;
    const visualReferences = options.visualReferences
      ? selectPanelVisualReferences(target, referenceIndex, allTargets, existingComicItems, options)
      : [];
    process.stdout.write(`[${index + 1}/${limitedTargets.length}] ${target.label}... `);
    const existing = options.force ? undefined : await findExistingGeneratedFileForTarget(scratchDirectory, target);
    const generated = existing ?? await generateImageWithRetries({
      provider,
      model,
      apiKey,
      prompt,
      aspectRatio: target.aspectRatio,
      openaiBaseUrl: options.openaiBaseUrl,
      vertexProjectId: options.vertexProjectId,
      vertexLocation: options.vertexLocation,
      visualReferences,
    });
    const sourceKey = `comic-panel:issue-01:${target.key}`;
    const existingComicItem = existingComicItems.get(target.key);
    const shouldReuseRegisteredFile = existingComicItem && !existingUsableComicKeys.has(sourceKey);
    const { id, fileName } = buildGeneratedPanelFileTarget({
      target,
      generated,
      existingItem: options.force || shouldReuseRegisteredFile ? existingComicItem : undefined,
    });
    const filePath = join(scratchDirectory, fileName);

    if (!existing || generated.fileName !== fileName) {
      await writeFile(filePath, generated.buffer);
    }

    const metadata = detectImageMetadata(generated.buffer, generated.mimeType);
    const item = createGeneratedSourceBinItem({
      target,
      projectDirectory: dirname(projectPath),
      scratchDirectory,
      fileName,
      mimeType: generated.mimeType,
      pixelWidth: metadata.width,
      pixelHeight: metadata.height,
      createdAt: Date.now(),
      id,
      prompt,
      provider,
      model,
      visualReferences: visualReferences.map(referenceToManifest),
    });
    workingProject = upsertGeneratedSourceBinItems(workingProject, [item]);
    await writeFile(projectPath, `${JSON.stringify(workingProject, null, 2)}\n`);
    referenceIndex = applyLockedVisualReferences(buildProjectVisualReferenceIndex(workingProject), lockedVisualReferences);
    updatedCount += 1;
    console.log(`${existing ? 'registered existing' : 'generated'} ${fileName} (${visualReferences.length} visual reference${visualReferences.length === 1 ? '' : 's'})`);
  }

  if (updatedCount > 0) {
    console.log(`Updated ${projectPath}`);
  } else {
    console.log('No new panel-art targets needed generation.');
  }
}

async function generateImageWithRetries(input) {
  let lastError;

  for (let attempt = 0; attempt <= IMAGE_GENERATION_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await generateImage(input);
    } catch (error) {
      lastError = error;
      const delay = IMAGE_GENERATION_RETRY_DELAYS_MS[attempt];

      if (!delay || !shouldRetryGenerationError(error)) {
        throw error;
      }

      process.stderr.write(`generation attempt ${attempt + 1} failed: ${formatErrorMessage(error)}; retrying in ${Math.round(delay / 1000)}s... `);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function generateImage(input) {
  if (input.provider === 'vertex') {
    return generateVertexGeminiImage(input);
  }

  if (input.provider === 'gemini') {
    return generateGeminiImage(input);
  }

  if (input.provider === 'openai') {
    return generateOpenAiImage(input);
  }

  throw new Error(`Unsupported provider: ${input.provider}`);
}

function shouldRetryGenerationError(error) {
  const message = formatErrorMessage(error).toLowerCase();
  if (message.includes('daily') || message.includes('quota') || message.includes('resource_exhausted')) return false;
  return [
    'fetch failed',
    'network',
    'timeout',
    'timed out',
    'econnreset',
    'etimedout',
    'socket',
    '503',
    '504',
    '502',
  ].some((needle) => message.includes(needle));
}

function formatErrorMessage(error) {
  return error?.message || String(error);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function buildGenerationPrompt(target, references, options) {
  const prompt = buildComicPanelPrompt(target, references, options);
  if (!options.restyleExisting) return prompt;

  return `RESTYLE / CORRECTION PASS.
The first attached image is the current panel composition draft. Preserve its useful composition, camera angle, rough staging, pose relationships, and story beat unless those conflict with the script. Redraw/restyle it into consistent finished comic panel art using the locked character, clothing, environment, and style references attached after it.

Correction priorities:
- Composition must still match the script beat.
- Character identity must match the character sheet references.
- Present-day Return House clothing must be the same seamless blue-gray garment system for every restored adult, including Samira, unless this target is explicitly a memory.
- Environment must match the referenced room/corridor/document/bay setting.
- Remove baked panel borders, gutters, page-layout marks, speech balloons, captions, SFX lettering, watermarks, and accidental UI.
- For document panels, use only exact target-specific literal text if the prompt provides it; otherwise leave clean readable form space.

${prompt}`;
}

async function generateGeminiImage({ apiKey, model, prompt, aspectRatio, visualReferences = [] }) {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey });
  const parts = await buildGeminiParts({ prompt, visualReferences });
  const response = await client.models.generateContent({
    model,
    contents: [{ parts }],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
    },
  });
  const part = response.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.data);
  const data = part?.inlineData?.data;

  if (!data) {
    throw new Error('Gemini returned no inline image data.');
  }

  return {
    mimeType: part.inlineData.mimeType ?? 'image/png',
    buffer: Buffer.from(data, 'base64'),
  };
}

async function generateVertexGeminiImage({
  model,
  prompt,
  aspectRatio,
  visualReferences = [],
  vertexProjectId,
  vertexLocation,
}) {
  const projectId = sanitizeVertexPathSegment(
    vertexProjectId
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCLOUD_PROJECT
    ?? process.env.CLOUDSDK_CORE_PROJECT
    ?? process.env.CLOUDSDK_PROJECT
    ?? DEFAULT_VERTEX_PROJECT_ID,
    'Vertex project ID',
  );
  const location = sanitizeVertexPathSegment(
    vertexLocation
    ?? process.env.GOOGLE_CLOUD_LOCATION
    ?? process.env.CLOUDSDK_COMPUTE_REGION
    ?? DEFAULT_VERTEX_LOCATION,
    'Vertex location',
  );
  const modelId = sanitizeVertexPathSegment(model, 'Vertex model ID');
  const token = await getGcloudAccessToken();
  const parts = await buildGeminiParts({ prompt, visualReferences });
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': projectId,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio },
        },
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(`Vertex AI image generation failed (${response.status}): ${message}`);
  }

  const inlineData = extractVertexInlineImage(payload);

  if (!inlineData?.data) {
    throw new Error('Vertex AI returned no inline image data.');
  }

  return {
    mimeType: inlineData.mimeType ?? 'image/png',
    buffer: Buffer.from(inlineData.data, 'base64'),
  };
}

async function generateOpenAiImage({ apiKey, model, prompt, aspectRatio, openaiBaseUrl }) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey,
    ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
  });
  const response = await client.images.generate({
    model,
    prompt,
    size: mapAspectRatioToOpenAiSize(aspectRatio),
  });
  const image = response.data?.[0];

  if (image?.b64_json) {
    return {
      mimeType: 'image/png',
      buffer: Buffer.from(image.b64_json, 'base64'),
    };
  }

  if (image?.url) {
    const fetched = await fetch(image.url);
    if (!fetched.ok) {
      throw new Error(`OpenAI image URL fetch failed: ${fetched.status} ${fetched.statusText}`);
    }

    return {
      mimeType: fetched.headers.get('content-type')?.split(';')[0] || 'image/png',
      buffer: Buffer.from(await fetched.arrayBuffer()),
    };
  }

  throw new Error('OpenAI returned no image payload.');
}

async function getGcloudAccessToken() {
  const command = resolveGcloudCommand();
  const args = resolveGcloudAuthArgs();
  const { stdout } = await execFileAsync(command, args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  const token = stdout.trim();

  if (!token) {
    throw new Error('gcloud returned an empty access token.');
  }

  return token;
}

function stripOptionalQuotes(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    if (trimmed.length === 1) {
      return '';
    }
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function resolveGcloudCommand() {
  return stripOptionalQuotes(process.env.GCLOUD_BIN || process.env.GCLOUD_BINARY || 'gcloud');
}

function resolveGcloudAuthAccount() {
  return stripOptionalQuotes(process.env.GCLOUD_ACCOUNT || process.env.CLOUDSDK_ACCOUNT || process.env.GOOGLE_CLOUD_ACCOUNT || '');
}

function resolveGcloudAuthArgs() {
  const args = ['auth', 'print-access-token'];
  const account = resolveGcloudAuthAccount();

  if (account) {
    args.push('--account', account);
  }

  return args;
}

function sanitizeVertexPathSegment(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  const trimmed = value.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error(`${label} contains unsupported characters.`);
  }

  return trimmed;
}

function extractVertexInlineImage(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      const inlineData = part?.inlineData ?? part?.inline_data;

      if (typeof inlineData?.data === 'string' && inlineData.data) {
        return {
          data: inlineData.data,
          mimeType: typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png',
        };
      }
    }
  }

  return undefined;
}

async function findExistingGeneratedFileForTarget(scratchDirectory, target) {
  if (!existsSync(scratchDirectory)) return undefined;
  const safeLabel = buildPanelAssetFileName('asset', target.label, 'png').replace(/^asset-/, '').replace(/\.png$/, '');
  const entries = await readdir(scratchDirectory);
  const matches = entries
    .filter((entry) => new RegExp(`-${escapeRegExp(safeLabel)}\\.(png|jpe?g|webp)$`, 'i').test(entry))
    .sort()
    .reverse();

  for (const match of matches) {
    const filePath = join(scratchDirectory, match);
    const fileStat = await stat(filePath).catch(() => undefined);

    if (!fileStat?.isFile() || fileStat.size <= 0) {
      continue;
    }

    const buffer = await readFile(filePath);
    const extension = extname(match).toLowerCase();
    const idMatch = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i.exec(match);

    return {
      id: idMatch?.[1],
      fileName: match,
      mimeType: extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/png',
      buffer,
    };
  }

  return undefined;
}

async function buildGeminiParts({ prompt, visualReferences }) {
  const parts = [{
    text: 'Use the following labeled visual references for continuity only. Preserve character identity, environment language, color handling, and comic art finish, but do not copy their composition unless the prompt explicitly asks for it.',
  }];

  for (const reference of visualReferences) {
    const imagePart = await readVisualReferencePart(reference);
    if (!imagePart) continue;
    parts.push({ text: describeVisualReference(reference) });
    parts.push({ inlineData: imagePart });
  }

  parts.push({ text: prompt });
  return parts;
}

async function readVisualReferencePart(reference) {
  if (!reference?.nativeFilePath || !existsSync(reference.nativeFilePath)) return undefined;
  const buffer = await readFile(reference.nativeFilePath);
  if (buffer.byteLength === 0) return undefined;
  return {
    mimeType: detectReferenceMimeType(buffer, reference.mimeType),
    data: buffer.toString('base64'),
  };
}

function selectPanelVisualReferences(target, referenceIndex, allTargets, existingComicItems, options) {
  const references = [];
  const compositionSource = options.restyleExisting ? existingComicItems.get(target.key) : undefined;

  if (compositionSource) {
    references.push(sourceItemToVisualReference(compositionSource, 'composition-source', target.key));
  }

  for (const reference of selectVisualReferencesForTarget(target, referenceIndex, allTargets, {
    maxReferences: Math.max(0, options.maxReferences - references.length),
  })) {
    references.push(reference);
  }

  return references.slice(0, options.maxReferences);
}

function sourceItemToVisualReference(item, role, id) {
  return {
    role,
    id,
    label: item.label ?? item.sourceKey ?? item.id ?? role,
    nativeFilePath: item.nativeFilePath,
    mimeType: item.mimeType,
    sourceKey: item.sourceKey,
  };
}

function describeVisualReference(reference) {
  const id = reference.id ? ` ${reference.id}` : '';
  const label = reference.label ? `: ${reference.label}` : '';

  switch (reference.role) {
    case 'composition-source':
      return `Visual reference${id}${label}. Current panel composition draft. Preserve the useful camera angle, framing, staging, and pose relationships, but correct character identity, clothing, environment details, and art style. Remove accidental borders, lettering, UI, or page-layout marks.`;
    case 'character-reference':
      return `Visual reference${id}${label}. Use for recurring character identity, face, build, hair, clothing language, and proportions.`;
    case 'environment-reference':
      return `Visual reference${id}${label}. Use for recurring environment architecture, materials, lighting, and spatial rules.`;
    case 'generated-panel-continuity':
      return `Visual reference${id}${label}. Already generated Issue 1 panel. Use for continuity of style, palette, staging language, and nearby panel consistency. Do not copy any visible panel border, caption, speech balloon, document text, or page layout marks.`;
    case 'existing-issue-panel-style':
      return `Visual reference${label}. Existing Issue 1 panel art. Use for the established art style and finish only. Do not copy any visible panel border, caption, speech balloon, document text, or page layout marks.`;
    case 'style-reference':
      return `Visual reference${label}. Reusable style/source-material anchor. Use for linework, rendering, color handling, and print-art finish only. Do not copy borders, lettering, or page layout marks.`;
    default:
      return `Visual reference${id}${label}. Use only for continuity relevant to this target.`;
  }
}

function detectReferenceMimeType(buffer, fallback) {
  if (buffer.length >= 12 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return fallback || 'image/png';
}

function referenceToManifest(reference) {
  return {
    role: reference.role,
    id: reference.id,
    label: reference.label,
    nativeFilePath: reference.nativeFilePath,
    sourceKey: shortSourceKey(reference.sourceKey),
  };
}

function shortSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string') return undefined;
  if (sourceKey.startsWith('comic-panel:issue-01:') || sourceKey.length <= 160) return sourceKey;
  return undefined;
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };

    switch (arg) {
      case '--project':
        options.project = next();
        break;
      case '--issue-dir':
        options.issueDir = next();
        break;
      case '--scratch-dir':
        options.scratchDirectory = next();
        break;
      case '--manifest':
        options.manifest = next();
        break;
      case '--provider':
        options.provider = next();
        break;
      case '--model':
        options.model = next();
        break;
      case '--api-key':
        options.apiKey = next();
        break;
      case '--api-key-file':
        options.apiKeyFile = next();
        break;
      case '--openai-base-url':
        options.openaiBaseUrl = next();
        break;
      case '--vertex-project':
      case '--vertex-project-id':
        options.vertexProjectId = next();
        break;
      case '--vertex-location':
        options.vertexLocation = next();
        break;
      case '--prompt-overrides':
        options.promptOverrides = next();
        break;
      case '--visual-reference-map':
        options.visualReferenceMap = next();
        break;
      case '--only':
        options.only = next();
        break;
      case '--limit':
        options.limit = Number(next());
        if (!Number.isFinite(options.limit) || options.limit < 0) throw new Error('--limit must be a non-negative number');
        break;
      case '--force':
        options.force = true;
        break;
      case '--restyle-existing':
        options.restyleExisting = true;
        options.force = true;
        break;
      case '--max-references':
        options.maxReferences = Number(next());
        if (!Number.isFinite(options.maxReferences) || options.maxReferences < 0) throw new Error('--max-references must be a non-negative number');
        break;
      case '--visual-references':
        options.visualReferences = true;
        break;
      case '--no-visual-references':
        options.visualReferences = false;
        break;
      case '--refresh-visual-reference-map':
        options.refreshVisualReferenceMap = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--use-signal-loom-settings':
        options.useSignalLoomSettings = true;
        break;
      case '--no-signal-loom-settings':
        options.useSignalLoomSettings = false;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.useSignalLoomSettings === undefined) {
    options.useSignalLoomSettings = true;
  }
  if (options.visualReferences === undefined) {
    options.visualReferences = true;
  }
  if (options.maxReferences === undefined) {
    options.maxReferences = 12;
  }

  return options;
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function ensurePromptOverridesFile(filePath) {
  if (existsSync(filePath)) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${defaultPromptOverridesTemplate()}\n`);
}

function defaultPromptOverridesTemplate() {
  return `# Issue #1 Panel Art Prompt Overrides

Add target-specific steering here when the script alone does not give the image model enough visual context.

Use a second-level heading matching the generation key, then write only the extra visual instruction. Example:

## example-key
Clarify camera placement, body language, props, continuity, or negative constraints that are not explicit in the script.

Real keys look like:
- cover
- p01-panel-01
- p03-panel-02
- p20-panel-05

Do not ask for speech balloons, lettering, captions, SFX text, panel borders, page gutters, UI, signatures, or watermarks. Paper will add those later.`;
}

function joinContextBlocks(blocks) {
  return blocks
    .filter(([, text]) => typeof text === 'string' && text.trim())
    .map(([label, text]) => `${label}:\n${text.trim()}`)
    .join('\n\n');
}

async function resolveApiKey(provider, options) {
  if (options.apiKey?.trim()) return options.apiKey.trim();
  if (options.apiKeyFile) return (await readFile(options.apiKeyFile, 'utf8')).trim();

  if (provider === 'gemini') {
    const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (envKey?.trim()) return envKey.trim();
  }

  if (provider === 'openai') {
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey?.trim()) return envKey.trim();
  }

  if (options.useSignalLoomSettings) {
    return readSignalLoomSettingsApiKey(provider);
  }

  return undefined;
}

async function loadOrCreateVisualReferenceMap(filePath, referenceIndex, options = {}) {
  if (!options.refresh && existsSync(filePath)) {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return normalizeVisualReferenceMap(parsed);
  }

  const locked = normalizeVisualReferenceMap({
    generatedAt: new Date().toISOString(),
    projectPath: options.projectPath,
    scratchDirectory: options.scratchDirectory,
    characters: Object.fromEntries(Array.from(referenceIndex.characters ?? [])),
    environments: Object.fromEntries(Array.from(referenceIndex.environments ?? [])),
    styleReferences: referenceIndex.styleReferences ?? [],
    issuePanelReferences: referenceIndex.issuePanelReferences ?? [],
  });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(locked, null, 2)}\n`);
  return locked;
}

function normalizeVisualReferenceMap(value) {
  return {
    generatedAt: value?.generatedAt,
    projectPath: value?.projectPath,
    scratchDirectory: value?.scratchDirectory,
    characters: normalizeReferenceRecord(value?.characters),
    environments: normalizeReferenceRecord(value?.environments),
    styleReferences: normalizeReferenceArray(value?.styleReferences),
    issuePanelReferences: normalizeReferenceArray(value?.issuePanelReferences),
  };
}

function normalizeReferenceRecord(value) {
  return Object.fromEntries(Object.entries(value ?? {})
    .filter(([, reference]) => typeof reference?.nativeFilePath === 'string' && reference.nativeFilePath)
    .map(([id, reference]) => [id, normalizeReference(reference, id)]));
}

function normalizeReferenceArray(value) {
  return Array.isArray(value)
    ? value
      .filter((reference) => typeof reference?.nativeFilePath === 'string' && reference.nativeFilePath)
      .map((reference) => normalizeReference(reference))
    : [];
}

function normalizeReference(reference, id) {
  return {
    role: reference.role,
    id: reference.id ?? id,
    label: reference.label,
    nativeFilePath: reference.nativeFilePath,
    mimeType: reference.mimeType,
  };
}

function applyLockedVisualReferences(referenceIndex, lockedVisualReferences) {
  if (!lockedVisualReferences) return referenceIndex;

  return {
    ...referenceIndex,
    characters: new Map(Object.entries(lockedVisualReferences.characters)),
    environments: new Map(Object.entries(lockedVisualReferences.environments)),
    styleReferences: lockedVisualReferences.styleReferences,
    issuePanelReferences: lockedVisualReferences.issuePanelReferences,
  };
}

async function readSignalLoomSettingsApiKey(provider) {
  const home = process.env.HOME;
  if (!home) return undefined;
  const roots = [
    join(home, '.config/Signal Loom/Local Storage/leveldb'),
    join(home, '.config/signal-loom/Local Storage/leveldb'),
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const entries = await readdir(root);
    const files = [];
    for (const entry of entries) {
      if (!/\.(ldb|log)$/i.test(entry)) continue;
      const filePath = join(root, entry);
      const fileStat = await stat(filePath);
      files.push({ filePath, mtimeMs: fileStat.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const file of files) {
      const buffer = await readFile(file.filePath);
      const parsed = parseSignalLoomSettingsFromLevelDbText(buffer);
      const key = parsed?.state?.apiKeys?.[provider];
      if (typeof key === 'string' && key.trim()) {
        return key.trim();
      }
      const recoveredKey = extractSignalLoomApiKeyFromPrintableStrings(buffer, provider);
      if (recoveredKey) {
        return recoveredKey;
      }
    }
  }

  return undefined;
}

export function parseSignalLoomSettingsFromLevelDbText(buffer) {
  const text = buffer.toString('utf8');
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const keyIndex = text.indexOf('flow-settings-storage', searchIndex);
    if (keyIndex < 0) return undefined;
    const jsonStart = text.indexOf('{"state"', keyIndex);
    if (jsonStart < 0) return undefined;
    const jsonText = readBalancedJson(text, jsonStart);
    searchIndex = jsonStart + 1;
    if (!jsonText) continue;

    try {
      return JSON.parse(jsonText);
    } catch {
      continue;
    }
  }

  return undefined;
}

function extractSignalLoomApiKeyFromPrintableStrings(buffer, provider) {
  const strings = extractPrintableStrings(buffer);
  const providerNeedle = provider === 'gemini' ? '"gemin' : `"${provider}`;

  for (let index = 0; index < strings.length; index += 1) {
    if (!strings[index].includes(providerNeedle)) continue;
    for (let offset = 1; offset <= 8 && index + offset < strings.length; offset += 1) {
      const candidate = strings[index + offset].trim();
      if (looksLikeApiKey(candidate, provider)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function extractPrintableStrings(buffer) {
  const strings = [];
  let current = '';

  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= 4) {
      strings.push(current);
    }
    current = '';
  }

  if (current.length >= 4) {
    strings.push(current);
  }

  return strings;
}

function looksLikeApiKey(candidate, provider) {
  if (provider === 'gemini') {
    return /^AIza[0-9A-Za-z_-]{20,}$/.test(candidate);
  }

  if (provider === 'openai') {
    return /^sk-[0-9A-Za-z_-]{20,}$/.test(candidate);
  }

  return candidate.length >= 24 && !candidate.includes('"') && !candidate.includes('{') && !candidate.includes('}');
}

function readBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return undefined;
}

function collectExistingSourceKeys(project) {
  return new Set((project.sourceBin?.bins ?? [])
    .flatMap((bin) => bin.items ?? [])
    .map((item) => item.sourceKey)
    .filter((key) => typeof key === 'string'));
}

function collectExistingComicPanelItems(project) {
  return new Map((project.sourceBin?.bins ?? [])
    .flatMap((bin) => bin.items ?? [])
    .filter((item) => typeof item.sourceKey === 'string' && item.sourceKey.startsWith('comic-panel:issue-01:'))
    .map((item) => [item.sourceKey.replace(/^comic-panel:issue-01:/, ''), item]));
}

function getExistingFileSize(filePath) {
  try {
    const fileStats = statSync(filePath);
    return fileStats.isFile() ? fileStats.size : undefined;
  } catch {
    return undefined;
  }
}

function detectImageMetadata(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return { width: undefined, height: undefined };
}

function mapAspectRatioToOpenAiSize(aspectRatio) {
  if (aspectRatio === '3:4' || aspectRatio === '9:16') return '1024x1536';
  if (aspectRatio === '16:9' || aspectRatio === '4:3') return '1536x1024';
  return '1024x1024';
}

function defaultScratchDirectory(projectPath) {
  const extension = extname(projectPath);
  const stem = extension ? basename(projectPath, extension) : basename(projectPath);
  return join(dirname(projectPath), `${stem}.signal-loom-scratch`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactTimestamp() {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function printHelp() {
  console.log(`Usage: node scripts/headless-comic-panel-art.mjs [options]

Generates Issue #1 comic panel art headlessly and registers successful images
in the Signal Loom .sloom Source Library.

Options:
  --project PATH              .sloom project path
  --issue-dir PATH            issue_01 script/reference directory
  --scratch-dir PATH          Signal Loom scratch directory
  --provider gemini|vertex|openai
                              generation provider (default: gemini)
  --model MODEL               image model id
  --api-key KEY               provider API key
  --api-key-file PATH         read provider API key from file
  --vertex-project PROJECT    Vertex AI project id for --provider vertex
  --vertex-location LOCATION  Vertex AI location for --provider vertex
  --prompt-overrides PATH     per-target prompt override markdown
  --visual-reference-map PATH locked character/environment/style reference map
  --only key,key              generate only specific keys, e.g. cover,p03-panel-04
  --limit N                   generate at most N targets
  --force                     regenerate keys already registered in source library
  --restyle-existing          use the existing generated panel as composition input and replace it
  --max-references N          max visual references sent per Gemini target (default: 12)
  --refresh-visual-reference-map
                              rebuild the locked reference map from the project
  --no-visual-references      disable project visual reference attachments
  --dry-run                   write manifest only, no API calls or project writes
  --manifest PATH             generation manifest path
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
