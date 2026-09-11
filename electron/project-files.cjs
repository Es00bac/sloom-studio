const { basename, dirname, extname, join, resolve } = require('node:path');
const { readdirSync } = require('node:fs');
const {
  MEDIA_FORMAT_REGISTRY,
  getFileExtension,
  inferDownloadExtension,
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
} = require('./media-format-registry.cjs');
const {
  CURRENT_PROJECT_SCHEMA_VERSION,
  FLOW_NODE_TYPES,
} = require('./project-schema.cjs');
const {
  restoreCanonicalScalarResult,
} = require('../shared/flow-result-values.cjs');

const SIGNAL_LOOM_PROJECT_EXTENSION = '.sloom';
const SIGNAL_LOOM_PROJECT_SCRATCH_SUFFIX = '.signal-loom-scratch';
const KNOWN_MEDIA_EXTENSIONS = new Set(MEDIA_FORMAT_REGISTRY.flatMap((format) => format.extensions.map((extension) => `.${extension}`)));
const VALID_NODE_TYPES = new Set(FLOW_NODE_TYPES);
const VALID_SOURCE_KINDS = new Set(['text', 'image', 'video', 'audio', 'composition', 'document', 'subtitle', 'package']);
const VALID_WORKSPACE_VIEWS = new Set(['flow', 'editor', 'image', 'paper']);
const VALID_USAGE_SOURCES = new Set(['actual', 'estimate']);
const VALID_USAGE_CONFIDENCE = new Set(['measured', 'heuristic', 'fixed', 'unknown']);
const VALID_RESULT_TYPES = new Set(['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope']);
const SHORT_ASSET_SIGNATURE_LIMIT = 240;
const ASSET_SIGNATURE_EDGE_SAMPLE = 96;
const RECOVERED_SCRATCH_ASSETS_BIN_ID = 'recovered-scratch-assets';
const RECOVERED_SCRATCH_SOURCE_KEY_PREFIX = 'recovered-scratch:';
const DEFAULT_FLOW_WORKSPACE_ID = 'main';
const DEFAULT_FLOW_WORKSPACE_NAME = 'Main Flow';

function ensureSignalLoomProjectExtension(filePath) {
  if (filePath.toLowerCase().endsWith(SIGNAL_LOOM_PROJECT_EXTENSION)) {
    return filePath;
  }

  return `${stripSignalLoomProjectExtension(filePath)}${SIGNAL_LOOM_PROJECT_EXTENSION}`;
}

function stripSignalLoomProjectExtension(filePath) {
  const lowerPath = filePath.toLowerCase();
  const knownExtension = lowerPath.endsWith(SIGNAL_LOOM_PROJECT_EXTENSION)
    ? SIGNAL_LOOM_PROJECT_EXTENSION
    : undefined;

  return knownExtension ? filePath.slice(0, -knownExtension.length) : filePath;
}

function isSignalLoomProjectBackupPath(filePath) {
  return typeof filePath === 'string'
    && basename(filePath).toLowerCase().includes(`${SIGNAL_LOOM_PROJECT_EXTENSION}.bak`);
}

function deriveRestoredProjectPathFromBackupPath(filePath) {
  if (!isSignalLoomProjectBackupPath(filePath)) {
    return ensureSignalLoomProjectExtension(filePath);
  }

  const fileName = basename(filePath);
  const lowerName = fileName.toLowerCase();
  const backupMarker = `${SIGNAL_LOOM_PROJECT_EXTENSION}.bak`;
  const backupMarkerIndex = lowerName.indexOf(backupMarker);
  const projectName = fileName.slice(0, backupMarkerIndex) || 'project';
  const rawBackupSuffix = fileName.slice(backupMarkerIndex + backupMarker.length).replace(/^[-_.]+/, '').trim();
  const backupSuffix = rawBackupSuffix ? sanitizeFileName(rawBackupSuffix) : '';
  const restoredName = backupSuffix
    ? `${projectName}-restored-from-${backupSuffix}${SIGNAL_LOOM_PROJECT_EXTENSION}`
    : `${projectName}-restored${SIGNAL_LOOM_PROJECT_EXTENSION}`;

  return join(dirname(filePath), restoredName);
}

function getProjectSaveDialogDefaultPath(filePath) {
  if (!filePath) {
    return `untitled${SIGNAL_LOOM_PROJECT_EXTENSION}`;
  }

  return isSignalLoomProjectBackupPath(filePath)
    ? deriveRestoredProjectPathFromBackupPath(filePath)
    : ensureSignalLoomProjectExtension(filePath);
}

function shouldWriteProjectSaveDirectly(filePath) {
  return typeof filePath === 'string'
    && Boolean(filePath.trim())
    && !isSignalLoomProjectBackupPath(filePath);
}

function buildProjectOverwriteBackupPath(filePath, now = new Date()) {
  const basePath = ensureSignalLoomProjectExtension(filePath);
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  return `${basePath}.bak-${timestamp}`;
}

function deriveProjectScratchDirectoryPath(filePath) {
  return `${stripSignalLoomProjectExtension(filePath)}${SIGNAL_LOOM_PROJECT_SCRATCH_SUFFIX}`;
}

function buildProjectScratchDirectoryCandidates(filePath, document) {
  const projectDirectoryPath = dirname(filePath);
  const candidates = [deriveProjectScratchDirectoryPath(filePath)];
  const savedScratchDirectoryName = document?.fileSystem?.scratchDirectoryName;

  if (typeof savedScratchDirectoryName === 'string' && savedScratchDirectoryName.trim()) {
    candidates.push(join(projectDirectoryPath, savedScratchDirectoryName));
  }

  candidates.push(join(projectDirectoryPath, 'scratch'));

  return [...new Set(candidates)];
}

function resolveScratchAssetNativePath(item, scratchDirectoryPaths, fileExists = () => false) {
  const nativeFilePath = typeof item?.nativeFilePath === 'string' ? item.nativeFilePath : undefined;
  const scratchFileName = typeof item?.scratchFileName === 'string' ? item.scratchFileName : undefined;
  const candidates = [
    nativeFilePath,
    ...(scratchFileName ? scratchDirectoryPaths.map((directoryPath) => join(directoryPath, scratchFileName)) : []),
  ].filter((filePath) => typeof filePath === 'string' && filePath.length > 0);
  const uniqueCandidates = [...new Set(candidates)];

  return uniqueCandidates.find((filePath) => fileExists(filePath)) ?? nativeFilePath ?? uniqueCandidates[0];
}

/**
 * A native item without a scratch filename is an intentionally linked source. Saving a project
 * must preserve that external reference instead of silently copying a feature-length original
 * into the project scratch directory.
 */
function getLinkedNativeSourcePath(item) {
  const nativeFilePath = optionalNonBlankString(item?.nativeFilePath);
  const scratchFileName = optionalNonBlankString(item?.scratchFileName);

  return nativeFilePath && !scratchFileName ? nativeFilePath : undefined;
}

function sanitizeFileName(value) {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
}

function getDefaultExtensionForNativeItem(item) {
  return inferDownloadExtension(item.mimeType, 'bin', item.kind);
}

function ensureFileNameHasExtension(fileName, item) {
  const extension = getFileExtension(fileName);
  return KNOWN_MEDIA_EXTENSIONS.has(extension ? `.${extension}` : extname(fileName).toLowerCase())
    ? fileName
    : `${fileName}.${getDefaultExtensionForNativeItem(item)}`;
}

function buildNativeScratchFileName(item) {
  const idPart = sanitizeFileName(item.id ?? `asset-${Date.now()}`);
  const labelPart = ensureFileNameHasExtension(sanitizeFileName(item.label ?? item.kind ?? 'asset'), item);

  return `${idPart}-${labelPart}`;
}

function collectSourceBinItems(sourceBin) {
  if (!sourceBin || typeof sourceBin !== 'object') {
    return [];
  }

  const binnedItems = Array.isArray(sourceBin.bins)
    ? sourceBin.bins.flatMap((bin) => Array.isArray(bin?.items) ? bin.items : [])
    : [];
  const flatItems = Array.isArray(sourceBin.items) ? sourceBin.items : [];

  return [...binnedItems, ...flatItems]
    .filter((item) => item && typeof item === 'object');
}

function mapSourceBinItems(sourceBin, mapItem) {
  if (!sourceBin || typeof sourceBin !== 'object') {
    return sourceBin;
  }

  const nextSourceBin = { ...sourceBin };

  if (Array.isArray(sourceBin.bins)) {
    nextSourceBin.bins = sourceBin.bins.map((bin) => ({
      ...bin,
      items: Array.isArray(bin?.items)
        ? bin.items.map((item) => item && typeof item === 'object' ? mapItem(item) : item)
        : bin?.items,
    }));
  }

  if (Array.isArray(sourceBin.items)) {
    nextSourceBin.items = sourceBin.items.map((item) =>
      item && typeof item === 'object' ? mapItem(item) : item,
    );
  }

  return nextSourceBin;
}

async function mapSourceBinItemsAsync(sourceBin, mapItem) {
  if (!sourceBin || typeof sourceBin !== 'object') {
    return sourceBin;
  }

  const nextSourceBin = { ...sourceBin };

  if (Array.isArray(sourceBin.bins)) {
    nextSourceBin.bins = await Promise.all(sourceBin.bins.map(async (bin) => ({
      ...bin,
      items: Array.isArray(bin?.items)
        ? await Promise.all(bin.items.map((item) => item && typeof item === 'object' ? mapItem(item) : item))
        : bin?.items,
    })));
  }

  if (Array.isArray(sourceBin.items)) {
    nextSourceBin.items = await Promise.all(sourceBin.items.map((item) =>
      item && typeof item === 'object' ? mapItem(item) : item,
    ));
  }

  return nextSourceBin;
}

function normalizeNativeAssetCapabilityPath(filePath) {
  return typeof filePath === 'string' && filePath.trim()
    ? resolve(filePath)
    : undefined;
}

function collectNativeAssetCapabilitiesFromSourceBin(sourceBin) {
  const capabilities = new Map();

  for (const item of collectSourceBinItems(sourceBin)) {
    if (!item || item.kind === 'text') {
      continue;
    }

    const assetId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : undefined;
    const nativeFilePath = normalizeNativeAssetCapabilityPath(item.nativeFilePath);
    if (nativeFilePath) {
      capabilities.set(nativeFilePath, { filePath: nativeFilePath, ...(assetId ? { assetId } : {}) });
    }

    if (typeof item.assetUrl === 'string' && item.assetUrl.startsWith('signal-loom-asset://')) {
      try {
        const parsedAsset = parseNativeAssetUrl(item.assetUrl);
        if (parsedAsset.type === 'file') {
          const decodedPath = normalizeNativeAssetCapabilityPath(parsedAsset.filePath);
          if (decodedPath && !capabilities.has(decodedPath)) {
            capabilities.set(decodedPath, { filePath: decodedPath, ...(assetId ? { assetId } : {}) });
          }
        }
      } catch {
        // Invalid persisted asset URLs are ignored here and handled by project validation/open flows.
      }
    }
  }

  return [...capabilities.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function collectNativeAssetCapabilityPathsFromSourceBin(sourceBin) {
  return collectNativeAssetCapabilitiesFromSourceBin(sourceBin).map((capability) => capability.filePath);
}

function createNativeAssetCapabilityRegistry(initialPaths = []) {
  const registeredPaths = new Set();
  const registry = {
    register(filePath) {
      const normalizedPath = normalizeNativeAssetCapabilityPath(filePath);
      if (normalizedPath) {
        registeredPaths.add(normalizedPath);
      }
      return normalizedPath;
    },
    registerMany(filePaths) {
      for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
        registry.register(filePath);
      }
      return registry;
    },
    has(filePath) {
      const normalizedPath = normalizeNativeAssetCapabilityPath(filePath);
      return Boolean(normalizedPath && registeredPaths.has(normalizedPath));
    },
    clear() {
      registeredPaths.clear();
    },
    list() {
      return [...registeredPaths].sort();
    },
    get size() {
      return registeredPaths.size;
    },
  };

  registry.registerMany(initialPaths);
  return registry;
}

function normalizeNativeAssetId(assetId) {
  return typeof assetId === 'string' && assetId.trim()
    ? encodeURIComponent(assetId.trim())
    : undefined;
}

function buildLegacyNativeAssetUrl(filePath) {
  return `signal-loom-asset://file/${Buffer.from(filePath, 'utf8').toString('base64url')}`;
}

function buildNativeAssetUrl(filePath, assetId) {
  const normalizedAssetId = normalizeNativeAssetId(assetId);
  return normalizedAssetId
    ? `signal-loom-asset://asset/${normalizedAssetId}`
    : buildLegacyNativeAssetUrl(filePath);
}

function parseNativeAssetUrl(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== 'signal-loom-asset:') {
    throw new Error('Unsupported Sloom Studio asset URL.');
  }

  if (parsed.hostname === 'file') {
    const encodedPath = parsed.pathname.replace(/^\/+/, '');
    return {
      type: 'file',
      filePath: Buffer.from(encodedPath, 'base64url').toString('utf8'),
    };
  }

  if (parsed.hostname === 'asset') {
    const assetId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!assetId) {
      throw new Error('Unsupported Sloom Studio asset URL.');
    }
    return {
      type: 'asset',
      assetId,
    };
  }

  throw new Error('Unsupported Sloom Studio asset URL.');
}

function decodeNativeAssetUrl(url) {
  const parsed = parseNativeAssetUrl(url);
  if (parsed.type !== 'file') {
    throw new Error('Opaque Sloom Studio asset URLs do not decode to file paths.');
  }
  return parsed.filePath;
}

function buildMediaAssetSignaturePart(url) {
  if (url.length <= SHORT_ASSET_SIGNATURE_LIMIT) {
    return url;
  }

  const head = url.slice(0, ASSET_SIGNATURE_EDGE_SAMPLE);
  const tail = url.slice(-ASSET_SIGNATURE_EDGE_SAMPLE);
  const hash = hashSignatureSample(`${head}:${tail}:${url.length}`);

  return `${head}...${tail}:len=${url.length}:hash=${hash}`;
}

function hashSignatureSample(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function extractRecoverableMediaSignatureFromSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string') {
    return undefined;
  }

  const dataUrlIndex = sourceKey.indexOf('data:');

  return dataUrlIndex >= 0 ? sourceKey.slice(dataUrlIndex) : undefined;
}

function inferMimeTypesForAssetBuffer(buffer, fileName, fallbackMimeType) {
  const mimeTypes = [];
  const addMimeType = (mimeType) => {
    if (typeof mimeType === 'string' && mimeType.trim() && !mimeTypes.includes(mimeType)) {
      mimeTypes.push(mimeType);
    }
  };

  if (Buffer.isBuffer(buffer)) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      addMimeType('image/jpeg');
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      addMimeType('image/png');
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      addMimeType('image/gif');
    } else if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
      && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      addMimeType('image/webp');
    }
  }

  const kind = inferSourceKindFromFile(fileName);
  addMimeType(kind ? inferMimeTypeFromFile(fileName, kind) : undefined);
  addMimeType(fallbackMimeType);

  return mimeTypes;
}

function buildDataUrlAssetSignatureCandidates(buffer, fileName, fallbackMimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    return [];
  }

  const base64Payload = buffer.toString('base64');

  return inferMimeTypesForAssetBuffer(buffer, fileName, fallbackMimeType).map((mimeType) =>
    buildMediaAssetSignaturePart(`data:${mimeType};base64,${base64Payload}`),
  );
}

function attachNativeScratchAssetsToProjectDocument(document, scratchDirectoryPath, isUsableAsset = () => true) {
  if (!document?.sourceBin) {
    return document;
  }

  const sourceBinWithRecoveredPaperAssets = recoverMissingPaperFrameSourceBinItems(
    document,
    document.sourceBin,
    scratchDirectoryPath,
    isUsableAsset,
  );

  return {
    ...document,
    sourceBin: mapSourceBinItems(
      sourceBinWithRecoveredPaperAssets,
      (item) => attachNativeScratchAssetToSourceBinItem(item, scratchDirectoryPath, isUsableAsset),
    ),
  };
}

function recoverMissingPaperFrameSourceBinItems(document, sourceBin, scratchDirectoryPath, isUsableAsset = () => true) {
  if (!document?.paper?.document || typeof scratchDirectoryPath !== 'string' || !scratchDirectoryPath) {
    return sourceBin;
  }

  const existingItems = collectSourceBinItems(sourceBin);
  const existingIds = new Set(existingItems.map((item) => optionalString(item?.id)).filter(Boolean));
  const recoveredItems = [];
  const recoveredAt = finiteOr(document?.savedAt, Date.now());

  for (const reference of collectPaperFrameAssetReferences(document)) {
    if (!reference.sourceBinItemId || existingIds.has(reference.sourceBinItemId)) {
      continue;
    }

    const scratchAsset = findScratchAssetForRecoveredSourceId(
      scratchDirectoryPath,
      reference.sourceBinItemId,
      isUsableAsset,
    );
    if (!scratchAsset) {
      continue;
    }

    const kind = optionalString(reference.kind) ?? inferSourceKindFromFile(scratchAsset.scratchFileName) ?? 'image';
    const mimeType = optionalString(reference.mimeType)
      ?? inferMimeTypeFromFile(scratchAsset.scratchFileName, kind)
      ?? 'application/octet-stream';
    recoveredItems.push({
      id: reference.sourceBinItemId,
      label: optionalString(reference.label) ?? optionalString(reference.frameLabel) ?? scratchAsset.scratchFileName,
      kind,
      mimeType,
      scratchFileName: scratchAsset.scratchFileName,
      nativeFilePath: scratchAsset.nativeFilePath,
      assetUrl: buildNativeAssetUrl(scratchAsset.nativeFilePath, reference.sourceBinItemId),
      pixelWidth: finiteOr(reference.pixelWidth, undefined),
      pixelHeight: finiteOr(reference.pixelHeight, undefined),
      createdAt: recoveredAt,
    });
    existingIds.add(reference.sourceBinItemId);
  }

  if (recoveredItems.length === 0) {
    return sourceBin;
  }

  if (Array.isArray(sourceBin?.bins) && sourceBin.bins.length > 0) {
    return {
      ...sourceBin,
      bins: sourceBin.bins.map((bin, index) => (
        index === 0
          ? { ...bin, items: [...recoveredItems, ...(Array.isArray(bin?.items) ? bin.items : [])] }
          : bin
      )),
    };
  }

  if (Array.isArray(sourceBin?.items)) {
    return {
      ...sourceBin,
      items: [...recoveredItems, ...sourceBin.items],
    };
  }

  return {
    ...sourceBin,
    bins: [{
      id: 'default',
      name: 'Source Library',
      collapsed: false,
      createdAt: recoveredAt,
      items: recoveredItems,
    }],
  };
}

function collectPaperFrameAssetReferences(document) {
  const paperDocuments = Array.isArray(document?.paper?.documents) && document.paper.documents.length > 0
    ? document.paper.documents.map((workspaceDocument) => workspaceDocument?.document).filter(Boolean)
    : document?.paper?.document
      ? [document.paper.document]
      : [];
  if (paperDocuments.length === 0) {
    return [];
  }

  const containers = paperDocuments.flatMap((paperDocument) => [
    ...(Array.isArray(paperDocument.parentPages) ? paperDocument.parentPages : []),
    ...(Array.isArray(paperDocument.pages) ? paperDocument.pages : []),
  ]);

  return containers.flatMap((container) => {
    if (!Array.isArray(container?.frames)) {
      return [];
    }

    return container.frames.flatMap((frame) => {
      const asset = frame?.asset;
      const sourceBinItemId = optionalString(asset?.sourceBinItemId);
      if (!sourceBinItemId) {
        return [];
      }

      return [{
        sourceBinItemId,
        frameLabel: optionalString(frame?.label),
        label: optionalString(asset?.label),
        kind: optionalString(asset?.kind),
        mimeType: optionalString(asset?.mimeType),
        pixelWidth: finiteOr(asset?.pixelWidth, undefined),
        pixelHeight: finiteOr(asset?.pixelHeight, undefined),
      }];
    });
  });
}

function findScratchAssetForRecoveredSourceId(scratchDirectoryPath, sourceBinItemId, isUsableAsset = () => true) {
  let entries = [];
  try {
    entries = readdirSync(scratchDirectoryPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const prefix = `${sourceBinItemId}-`;
  const match = entries
    .filter((entry) => entry?.isFile?.() && entry.name.startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name))
    .find((entry) => isUsableAsset(join(scratchDirectoryPath, entry.name)));

  if (!match) {
    return undefined;
  }

  return {
    scratchFileName: match.name,
    nativeFilePath: join(scratchDirectoryPath, match.name),
  };
}

function attachNativeScratchAssetToSourceBinItem(item, scratchDirectoryPath, isUsableAsset = () => true) {
  if (!item || item.kind === 'text') {
    return item;
  }

  const nativeFilePath = item.scratchFileName
    ? join(scratchDirectoryPath, item.scratchFileName)
    : item.nativeFilePath;

  if (!nativeFilePath) {
    return item;
  }

  if (!isUsableAsset(nativeFilePath)) {
    return {
      ...item,
      nativeFilePath,
    };
  }

  return {
    ...item,
    nativeFilePath,
    assetUrl: buildNativeAssetUrl(nativeFilePath, item.id),
  };
}

function parseProjectDocumentJson(contents) {
  let parsed;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    throw new Error(`The selected project could not be parsed. ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || (!parsed.flow && !parsed.flowWorkspaces)) {
    throw new Error('The selected file is not a valid Sloom Studio project.');
  }

  return sanitizeProjectDocument(parsed);
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isTransientRecoveredScratchAssetItem(item) {
  return typeof item?.sourceKey === 'string' && item.sourceKey.startsWith(RECOVERED_SCRATCH_SOURCE_KEY_PREFIX);
}

function removeTransientRecoveredScratchAssetsFromSourceBin(sourceBin) {
  if (!isObject(sourceBin)) return sourceBin;
  const nextSourceBin = { ...sourceBin };

  if (Array.isArray(sourceBin.bins)) {
    const bins = sourceBin.bins.flatMap((bin) => {
      if (!isObject(bin) || bin.id === RECOVERED_SCRATCH_ASSETS_BIN_ID) {
        return [];
      }

      return [{
        ...bin,
        items: Array.isArray(bin.items)
          ? bin.items.filter((item) => !isTransientRecoveredScratchAssetItem(item))
          : bin.items,
      }];
    });
    nextSourceBin.bins = bins.length > 0 ? bins : undefined;
  }

  if (Array.isArray(sourceBin.items)) {
    const items = sourceBin.items.filter((item) => !isTransientRecoveredScratchAssetItem(item));
    nextSourceBin.items = items.length > 0 ? items : undefined;
  }

  return nextSourceBin;
}

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

function optionalNonBlankString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function sanitizeUsage(value) {
  if (!isObject(value) || !VALID_USAGE_SOURCES.has(value.source) || !VALID_USAGE_CONFIDENCE.has(value.confidence)) {
    return undefined;
  }
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note) => typeof note === 'string' && note.trim())
    : undefined;
  return {
    source: value.source,
    confidence: value.confidence,
    provider: optionalNonBlankString(value.provider),
    modelId: optionalNonBlankString(value.modelId),
    costUsd: finiteOr(value.costUsd, undefined),
    inputTokens: finiteOr(value.inputTokens, undefined),
    outputTokens: finiteOr(value.outputTokens, undefined),
    totalTokens: finiteOr(value.totalTokens, undefined),
    characters: finiteOr(value.characters, undefined),
    durationSeconds: finiteOr(value.durationSeconds, undefined),
    imageCount: finiteOr(value.imageCount, undefined),
    notes: notes && notes.length > 0 ? notes : undefined,
  };
}

const SAFE_OUTPUT_METADATA_MAX_DEPTH = 12;
const SAFE_OUTPUT_METADATA_MAX_KEYS_PER_OBJECT = 64;
const SAFE_OUTPUT_METADATA_MAX_KEYS = 256;
const SAFE_OUTPUT_METADATA_MAX_ARRAY_LENGTH = 256;
const SAFE_OUTPUT_METADATA_MAX_STRING_BYTES = 16 * 1024;
const SAFE_OUTPUT_METADATA_MAX_KEY_BYTES = 512;
const SAFE_OUTPUT_METADATA_MAX_NODES = 1024;
const SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES = 1024 * 1024;
const UNSAFE_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function utf8ByteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function sanitizeMetadataValue(value) {
  const seen = new WeakSet();
  let nodeCount = 0;
  let keyCount = 0;
  let estimatedUtf8Bytes = 0;

  const visit = (candidate, depth) => {
    nodeCount += 1;
    if (nodeCount > SAFE_OUTPUT_METADATA_MAX_NODES || depth > SAFE_OUTPUT_METADATA_MAX_DEPTH) return undefined;

    if (candidate === null || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') return Number.isFinite(candidate) ? candidate : undefined;
    if (typeof candidate === 'string') {
      const bytes = utf8ByteLength(candidate);
      estimatedUtf8Bytes += bytes;
      return bytes <= SAFE_OUTPUT_METADATA_MAX_STRING_BYTES && estimatedUtf8Bytes <= SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES
        ? candidate
        : undefined;
    }
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return undefined;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > SAFE_OUTPUT_METADATA_MAX_ARRAY_LENGTH) return undefined;
      const keys = Reflect.ownKeys(candidate);
      if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) return undefined;
      const items = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
        const sanitized = visit(descriptor.value, depth + 1);
        if (sanitized === undefined) return undefined;
        items.push(sanitized);
      }
      return items;
    }

    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(candidate);
    if (keys.length > SAFE_OUTPUT_METADATA_MAX_KEYS_PER_OBJECT || keys.some((key) => typeof key !== 'string')) return undefined;
    keyCount += keys.length;
    if (keyCount > SAFE_OUTPUT_METADATA_MAX_KEYS) return undefined;

    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || UNSAFE_METADATA_KEYS.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
      const keyBytes = utf8ByteLength(key);
      estimatedUtf8Bytes += keyBytes;
      if (keyBytes > SAFE_OUTPUT_METADATA_MAX_KEY_BYTES || estimatedUtf8Bytes > SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES) return undefined;
      const sanitized = visit(descriptor.value, depth + 1);
      if (sanitized === undefined) return undefined;
      Object.defineProperty(result, key, { value: sanitized, enumerable: true, configurable: true, writable: true });
    }
    return result;
  };

  try {
    const sanitized = visit(value, 0);
    if (sanitized === undefined) return undefined;
    return utf8ByteLength(JSON.stringify(sanitized)) <= SAFE_OUTPUT_METADATA_MAX_UTF8_BYTES ? sanitized : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeOutputMetadata(value) {
  const sanitized = sanitizeMetadataValue(value);
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === 'object' ? sanitized : undefined;
}

function sanitizeResultHistory(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((attempt, index) => {
    if (!isObject(attempt) || !VALID_RESULT_TYPES.has(attempt.resultType)) {
      return [];
    }
    const result = restoreCanonicalScalarResult(attempt.result, attempt.resultType);
    if (result === undefined || (typeof result === 'string' && result === '')) return [];
    return [{
      id: stringOr(attempt.id, `attempt-${index}`),
      result,
      resultType: attempt.resultType,
      statusMessage: stringOr(attempt.statusMessage, 'Restored result'),
      createdAt: stringOr(attempt.createdAt, new Date(0).toISOString()),
      usage: sanitizeUsage(attempt.usage),
      mimeType: optionalNonBlankString(attempt.mimeType),
      extension: optionalNonBlankString(attempt.extension),
      fileName: optionalNonBlankString(attempt.fileName),
      outputMetadata: sanitizeOutputMetadata(attempt.outputMetadata),
      variableName: optionalNonBlankString(attempt.variableName),
      sourceBinItemId: optionalNonBlankString(attempt.sourceBinItemId),
    }];
  });
}

function restoreSelectedResultFromHistory(data, history) {
  if (history.length === 0) return;
  const selected = typeof data.selectedResultId === 'string'
    ? history.find((attempt) => attempt.id === data.selectedResultId)
    : undefined;
  const active = selected ?? history[history.length - 1];
  if (!active) return;
  data.selectedResultId = active.id;
  data.result = active.result;
  data.resultType = active.resultType;
  data.usage = active.usage;
  data.error = undefined;
  data.resultMimeType = active.mimeType;
  data.resultExtension = active.extension;
  data.resultFileName = active.fileName;
  data.resultOutputMetadata = active.outputMetadata;
}

function sanitizeNodeData(value, nodeType) {
  const data = isObject(value) ? { ...value } : {};
  const history = sanitizeResultHistory(data.resultHistory);
  delete data.onChange;
  delete data.onRun;
  delete data.onSelectAttempt;
  data.isRunning = undefined;
  data.error = undefined;
  data.statusMessage = undefined;
  if (Object.hasOwn(data, 'resultOutputMetadata')) {
    data.resultOutputMetadata = sanitizeOutputMetadata(data.resultOutputMetadata);
  }
  if (data.resultType === 'boolean' && Object.hasOwn(data, 'result')) {
    const result = restoreCanonicalScalarResult(data.result, 'boolean');
    if (result === undefined) {
      delete data.result;
      delete data.resultType;
    } else {
      data.result = result;
    }
  }
  if (history !== undefined) {
    data.resultHistory = history;
    if (data.selectedResultId && !history.some((attempt) => attempt.id === data.selectedResultId)) {
      data.selectedResultId = history[history.length - 1]?.id;
    }
    restoreSelectedResultFromHistory(data, history);
  }

  // AUD-033 wrote legacy Vision Verify decisions as text. Do not apply this
  // migration to arbitrary Text nodes whose literal value happens to be true/false.
  if (nodeType === 'visionVerifyNode') {
    if (Array.isArray(data.resultHistory)) {
      data.resultHistory = data.resultHistory.map((attempt) => {
        const legacyValue = attempt.resultType === 'text' ? restoreCanonicalScalarResult(attempt.result, 'boolean') : undefined;
        return legacyValue === undefined
          ? attempt
          : { ...attempt, result: legacyValue, resultType: 'boolean' };
      });
      restoreSelectedResultFromHistory(data, data.resultHistory);
    }
    const legacyValue = data.resultType === 'text' ? restoreCanonicalScalarResult(data.result, 'boolean') : undefined;
    if (legacyValue !== undefined) {
      data.result = legacyValue;
      data.resultType = 'boolean';
    } else if (typeof data.result === 'boolean') {
      data.resultType = 'boolean';
    }
  }
  return data;
}

function sanitizeFlowSnapshot(flow) {
  if (!isObject(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error('The selected file is not a valid Sloom Studio project.');
  }
  const seenNodeIds = new Set();
  const nodes = flow.nodes.flatMap((node, index) => {
    if (!isObject(node)) return [];
    const type = node.type === 'input' ? 'textNode' : node.type;
    if (!VALID_NODE_TYPES.has(type)) return [];
    const id = stringOr(node.id, `node-${index}`);
    if (seenNodeIds.has(id)) return [];
    seenNodeIds.add(id);
    const position = isObject(node.position) ? node.position : {};
    return [{
      ...node,
      id,
      type,
      position: { x: finiteOr(position.x, 0), y: finiteOr(position.y, 0) },
      data: sanitizeNodeData(node.data, type),
    }];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set();
  const edges = flow.edges.flatMap((edge, index) => {
    if (!isObject(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') return [];
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return [];
    const id = stringOr(edge.id, `${edge.source}-${edge.target}-${index}`);
    if (seenEdgeIds.has(id)) return [];
    seenEdgeIds.add(id);
    return [{ ...edge, id, sourceHandle: optionalString(edge.sourceHandle), targetHandle: optionalString(edge.targetHandle) }];
  });
  return { version: finiteOr(flow.version, 3), nodes, edges };
}

function sanitizeSourceBinItem(item, index) {
  if (!isObject(item) || !VALID_SOURCE_KINDS.has(item.kind)) return undefined;
  const assetUrl = optionalString(item.assetUrl);
  const assetId = optionalString(item.assetId);
  const scratchFileName = optionalString(item.scratchFileName);
  const nativeFilePath = optionalString(item.nativeFilePath);
  const text = optionalString(item.text);
  if (item.kind === 'text' && !text && !assetUrl) return undefined;
  if (item.kind !== 'text' && !assetUrl && !assetId && !scratchFileName && !nativeFilePath) return undefined;
  return {
    ...item,
    id: stringOr(item.id, `source-item-${index}`),
    label: stringOr(item.label, item.kind),
    assetUrl,
    assetId,
    scratchFileName,
    nativeFilePath,
    text,
    createdAt: finiteOr(item.createdAt, Date.now()),
  };
}

function sanitizeSourceBinSnapshot(sourceBin) {
  if (!isObject(sourceBin)) return undefined;
  const sourceBinWithoutRecovered = removeTransientRecoveredScratchAssetsFromSourceBin(sourceBin);
  const bins = Array.isArray(sourceBinWithoutRecovered.bins)
    ? sourceBinWithoutRecovered.bins.flatMap((bin, index) => {
      if (!isObject(bin)) return [];
      return [{
        ...bin,
        id: stringOr(bin.id, index === 0 ? 'default' : `bin-${index}`),
        name: stringOr(bin.name, index === 0 ? 'Source Library' : 'Recovered Bin'),
        items: Array.isArray(bin.items) ? bin.items.flatMap((item, itemIndex) => sanitizeSourceBinItem(item, itemIndex) ?? []) : [],
        createdAt: finiteOr(bin.createdAt, Date.now()),
      }];
    })
    : undefined;
  const items = Array.isArray(sourceBinWithoutRecovered.items)
    ? sourceBinWithoutRecovered.items.flatMap((item, index) => sanitizeSourceBinItem(item, index) ?? [])
    : undefined;
  return {
    ...sourceBinWithoutRecovered,
    bins: bins && bins.length > 0 ? bins : undefined,
    items: bins && bins.length > 0 ? undefined : items,
    dismissedSourceKeys: Array.isArray(sourceBinWithoutRecovered.dismissedSourceKeys) ? sourceBinWithoutRecovered.dismissedSourceKeys.filter((key) => typeof key === 'string') : [],
  };
}

const GENERATED_RESULT_TYPES_BY_NODE = {
  imageGen: ['image'],
  cropImageNode: ['image'],
  videoGen: ['video'],
  audioGen: ['audio'],
  composition: ['video'],
  packageNode: ['package'],
};

function resultTypeForSourceKind(kind) {
  switch (kind) {
    case 'image': return 'image';
    case 'video':
    case 'composition': return 'video';
    case 'audio': return 'audio';
    case 'package': return 'package';
    default: return undefined;
  }
}

function sourceBinItemBelongsToFlowNode(item, nodeId) {
  return item.originNodeId === nodeId
    || item.envelopeId === nodeId
    || (typeof item.originNodeId === 'string' && item.originNodeId.startsWith(`${nodeId}:`));
}

function sourceBinItemToResultAttempt(item, index) {
  const resultType = resultTypeForSourceKind(item.kind);
  const result = item.assetUrl;
  if (typeof result !== 'string' || !result || !resultType) return undefined;
  return {
    id: `source-${item.id || index}`,
    result,
    resultType,
    statusMessage: `Restored ${item.label || resultType} from project source bin`,
    createdAt: new Date(item.createdAt || 0).toISOString(),
    sourceBinItemId: item.id || undefined,
  };
}

function isNodeResultAttempt(value) {
  if (!isObject(value) || !VALID_RESULT_TYPES.has(value.resultType)) return false;
  return (value.resultType === 'boolean'
    ? typeof value.result === 'boolean'
    : typeof value.result === 'string' && value.result.length > 0)
    && typeof value.id === 'string'
    && typeof value.statusMessage === 'string'
    && typeof value.createdAt === 'string';
}

function restoreGeneratedResultFromSourceBin(node, sourceBin) {
  const compatibleResultTypes = GENERATED_RESULT_TYPES_BY_NODE[node.type];
  if (!compatibleResultTypes) return { ...node, data: { ...node.data } };
  const sourceItems = collectSourceBinItems(sourceBin)
    .filter((item) => sourceBinItemBelongsToFlowNode(item, node.id))
    .sort((a, b) => (a.envelopeIndex ?? a.createdAt ?? 0) - (b.envelopeIndex ?? b.createdAt ?? 0));
  const sourceHistory = sourceItems
    .map((item, index) => sourceBinItemToResultAttempt(item, index))
    .filter((attempt) => attempt && compatibleResultTypes.includes(attempt.resultType));
  const data = { ...node.data };
  const existingHistory = Array.isArray(data.resultHistory) ? data.resultHistory.filter(isNodeResultAttempt) : [];
  const history = existingHistory.length > 0 ? existingHistory : sourceHistory;
  if (history.length === 0) return { ...node, data };

  const selected = typeof data.selectedResultId === 'string'
    ? history.find((attempt) => attempt.id === data.selectedResultId)
    : undefined;
  const active = selected ?? history[history.length - 1];
  data.resultHistory = history;
  data.selectedResultId = active.id;
  data.result = active.result;
  data.resultType = active.resultType;
  data.usage = active.usage;
  if (existingHistory.length === 0) data.statusMessage = active.statusMessage;
  data.resultMimeType = active.mimeType;
  data.resultExtension = active.extension;
  data.resultFileName = active.fileName;
  data.resultOutputMetadata = active.outputMetadata;
  return { ...node, data };
}

function hydrateFlowSnapshotFromSourceBin(flow, sourceBin) {
  return {
    ...flow,
    nodes: flow.nodes.map((node) => restoreGeneratedResultFromSourceBin(node, sourceBin)),
  };
}

function sanitizeProjectUsageLedgerEntry(entry, index) {
  if (!isObject(entry)) return undefined;
  if (!VALID_USAGE_SOURCES.has(entry.source) || !VALID_USAGE_CONFIDENCE.has(entry.confidence)) return undefined;
  const operation = optionalString(entry.operation);
  if (!operation) return undefined;
  return {
    id: stringOr(entry.id, `usage-${index}`),
    createdAt: finiteOr(entry.createdAt, Date.now()),
    workspace: VALID_WORKSPACE_VIEWS.has(entry.workspace) ? entry.workspace : 'flow',
    flowWorkspaceId: entry.workspace === 'flow' ? optionalString(entry.flowWorkspaceId) : undefined,
    flowWorkspaceName: entry.workspace === 'flow' ? optionalString(entry.flowWorkspaceName) : undefined,
    operation,
    nodeId: optionalString(entry.nodeId),
    nodeType: VALID_NODE_TYPES.has(entry.nodeType) ? entry.nodeType : undefined,
    provider: optionalString(entry.provider),
    modelId: optionalString(entry.modelId),
    source: entry.source,
    confidence: entry.confidence,
    costUsd: finiteOr(entry.costUsd, undefined),
    inputTokens: finiteOr(entry.inputTokens, undefined),
    outputTokens: finiteOr(entry.outputTokens, undefined),
    totalTokens: finiteOr(entry.totalTokens, undefined),
    characters: finiteOr(entry.characters, undefined),
    durationSeconds: finiteOr(entry.durationSeconds, undefined),
    imageCount: finiteOr(entry.imageCount, undefined),
    notes: Array.isArray(entry.notes) ? entry.notes.filter((note) => typeof note === 'string' && note.trim()) : undefined,
  };
}

function sanitizeProjectUsageLedgerSnapshot(usageLedger) {
  if (!isObject(usageLedger)) return undefined;
  return {
    version: 1,
    entries: Array.isArray(usageLedger.entries)
      ? usageLedger.entries.flatMap((entry, index) => sanitizeProjectUsageLedgerEntry(entry, index) ?? [])
      : [],
  };
}

function buildDefaultFlowWorkspace(flow, now = Date.now()) {
  return {
    id: DEFAULT_FLOW_WORKSPACE_ID,
    name: DEFAULT_FLOW_WORKSPACE_NAME,
    createdAt: now,
    updatedAt: now,
    flow,
  };
}

function findActiveFlowWorkspace(flowWorkspaces, activeFlowWorkspaceId) {
  if (!Array.isArray(flowWorkspaces) || flowWorkspaces.length === 0) {
    return undefined;
  }

  return flowWorkspaces.find((workspace) => workspace?.id === activeFlowWorkspaceId) ?? flowWorkspaces[0];
}

function sanitizeFlowWorkspaceSnapshot(snapshot, index, sourceBin) {
  if (!isObject(snapshot) || !snapshot.flow) {
    return undefined;
  }

  const createdAt = finiteOr(snapshot.createdAt, Date.now());

  return {
    id: stringOr(snapshot.id, index === 0 ? DEFAULT_FLOW_WORKSPACE_ID : `flow-workspace-${index + 1}`),
    name: stringOr(snapshot.name, index === 0 ? DEFAULT_FLOW_WORKSPACE_NAME : `Flow Workspace ${index + 1}`),
    createdAt,
    updatedAt: finiteOr(snapshot.updatedAt, createdAt),
    flow: hydrateFlowSnapshotFromSourceBin(sanitizeFlowSnapshot(snapshot.flow), sourceBin),
  };
}

function sanitizeFlowWorkspaceState(document, sourceBin) {
  const legacyFlow = document.flow ? hydrateFlowSnapshotFromSourceBin(sanitizeFlowSnapshot(document.flow), sourceBin) : undefined;
  const sanitizedWorkspaces = Array.isArray(document.flowWorkspaces)
    ? document.flowWorkspaces.flatMap((workspace, index) => sanitizeFlowWorkspaceSnapshot(workspace, index, sourceBin) ?? [])
    : [];
  const flowWorkspaces = sanitizedWorkspaces.length > 0
    ? sanitizedWorkspaces
    : legacyFlow
      ? [buildDefaultFlowWorkspace(legacyFlow)]
      : [];
  const activeFlowWorkspaceId = optionalString(document.activeFlowWorkspaceId);
  const activeWorkspace = findActiveFlowWorkspace(flowWorkspaces, activeFlowWorkspaceId);

  if (!activeWorkspace) {
    throw new Error('The selected file is not a valid Sloom Studio project.');
  }

  return {
    flow: activeWorkspace.flow,
    flowWorkspaces,
    activeFlowWorkspaceId: activeWorkspace.id,
  };
}

function sanitizeProjectDocument(document) {
  const sourceBin = sanitizeSourceBinSnapshot(document.sourceBin);
  const flowWorkspaceState = sanitizeFlowWorkspaceState(document, sourceBin);

  return {
    ...document,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: stringOr(document.id, `project-${Date.now()}`),
    name: stringOr(document.name, 'Sloom Studio Project'),
    savedAt: finiteOr(document.savedAt, Date.now()),
    flow: flowWorkspaceState.flow,
    flowWorkspaces: flowWorkspaceState.flowWorkspaces,
    activeFlowWorkspaceId: flowWorkspaceState.activeFlowWorkspaceId,
    sourceBin,
    usageLedger: sanitizeProjectUsageLedgerSnapshot(document.usageLedger),
    fileSystem: isObject(document.fileSystem) ? {
      projectDirectoryName: optionalString(document.fileSystem.projectDirectoryName),
      scratchDirectoryName: optionalString(document.fileSystem.scratchDirectoryName),
      lastSavedToFolderAt: finiteOr(document.fileSystem.lastSavedToFolderAt, undefined),
      scratchAssetCount: finiteOr(document.fileSystem.scratchAssetCount, undefined),
    } : undefined,
  };
}

module.exports = {
  CURRENT_PROJECT_SCHEMA_VERSION,
  FLOW_NODE_TYPES,
  SIGNAL_LOOM_PROJECT_EXTENSION,
  SIGNAL_LOOM_PROJECT_SCRATCH_SUFFIX,
  attachNativeScratchAssetsToProjectDocument,
  buildDataUrlAssetSignatureCandidates,
  buildLegacyNativeAssetUrl,
  buildMediaAssetSignaturePart,
  buildNativeAssetUrl,
  buildNativeScratchFileName,
  buildProjectOverwriteBackupPath,
  buildProjectScratchDirectoryCandidates,
  collectNativeAssetCapabilitiesFromSourceBin,
  collectNativeAssetCapabilityPathsFromSourceBin,
  collectSourceBinItems,
  createNativeAssetCapabilityRegistry,
  decodeNativeAssetUrl,
  deriveRestoredProjectPathFromBackupPath,
  deriveProjectScratchDirectoryPath,
  ensureSignalLoomProjectExtension,
  extractRecoverableMediaSignatureFromSourceKey,
  getLinkedNativeSourcePath,
  getProjectSaveDialogDefaultPath,
  isSignalLoomProjectBackupPath,
  mapSourceBinItems,
  parseNativeAssetUrl,
  mapSourceBinItemsAsync,
  parseProjectDocumentJson,
  removeTransientRecoveredScratchAssetsFromSourceBin,
  resolveScratchAssetNativePath,
  sanitizeProjectDocument,
  sanitizeFileName,
  shouldWriteProjectSaveDirectly,
  stripSignalLoomProjectExtension,
};
