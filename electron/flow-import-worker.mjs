import { basename } from 'node:path';
import { parentPort } from 'node:worker_threads';
import mediaFormatRegistryModule from './media-format-registry.cjs';

const {
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
} = mediaFormatRegistryModule;

function normalizeImportedMediaBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.flatMap((item) => {
    const filePath = typeof item?.filePath === 'string' ? item.filePath.trim() : '';
    if (!filePath) {
      return [];
    }

    const inferredKind = typeof item?.kind === 'string' && item.kind.trim()
      ? item.kind.trim()
      : inferSourceKindFromFile(filePath);
    if (!inferredKind) {
      return [];
    }

    const label = typeof item?.label === 'string' && item.label.trim()
      ? item.label.trim()
      : basename(filePath);
    const mimeType = typeof item?.mimeType === 'string' && item.mimeType.trim()
      ? item.mimeType.trim()
      : inferMimeTypeFromFile(filePath, inferredKind);

    return [{
      filePath,
      label,
      kind: inferredKind,
      mimeType,
    }];
  });
}

if (!parentPort) {
  throw new Error('Flow import worker requires a parent port.');
}

parentPort.on('message', (payload) => {
  try {
    if (!payload || payload.type !== 'normalize-imported-media-batch') {
      parentPort.postMessage({
        error: 'Unsupported Flow import worker request.',
      });
      return;
    }

    parentPort.postMessage({
      items: normalizeImportedMediaBatch(payload.items),
    });
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : 'Flow import worker failed.',
    });
  }
});
