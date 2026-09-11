import type { AppNode } from '../types/flow';
import { resultValueAsMediaUrl } from './flowResultValues';
import { buildDownloadFilename, downloadAsset } from './downloadAsset';

export interface ExportableProjectAsset {
  id: string;
  nodeId: string;
  label: string;
  url: string;
  mimeType: string;
  fileName: string;
}

export function collectExportableProjectAssets(nodes: AppNode[]): ExportableProjectAsset[] {
  const assets = new Map<string, ExportableProjectAsset>();

  for (const node of nodes) {
    const asset = buildProjectAsset(node);

    if (asset && !assets.has(asset.id)) {
      assets.set(asset.id, asset);
    }
  }

  return [...assets.values()];
}

export async function exportProjectAssets(nodes: AppNode[]): Promise<ExportableProjectAsset[]> {
  const assets = collectExportableProjectAssets(nodes);

  for (const asset of assets) {
    await downloadAsset(asset.url, asset.fileName);
  }

  return assets;
}

function buildProjectAsset(node: AppNode): ExportableProjectAsset | undefined {
  if (node.type === 'imageGen' || node.type === 'cropImageNode') {
    const url = resolveNodeAssetUrl(node);

    if (!url) {
      return undefined;
    }

    const mimeType = inferMimeType(url, node.data.sourceAssetMimeType, 'image/png');
    return {
      id: `${node.id}:${url.slice(0, 32)}`,
      nodeId: node.id,
      label: node.type === 'cropImageNode' ? node.data.customTitle ?? 'cropped image' : node.data.sourceAssetName ?? node.data.modelId ?? 'image',
      url,
      mimeType,
      fileName: buildDownloadFilename(
        node.type === 'cropImageNode' ? node.data.customTitle ?? `${node.id}-crop` : node.data.sourceAssetName ?? `${node.id}-image`,
        mimeType,
        'png',
      ),
    };
  }

  if (node.type === 'videoGen' || node.type === 'composition') {
    const url = resolveNodeAssetUrl(node);

    if (!url) {
      return undefined;
    }

    const mimeType = inferMimeType(url, node.data.sourceAssetMimeType, 'video/mp4');
    return {
      id: `${node.id}:${url.slice(0, 32)}`,
      nodeId: node.id,
      label: node.data.sourceAssetName ?? node.data.modelId ?? 'video',
      url,
      mimeType,
      fileName: buildDownloadFilename(node.data.sourceAssetName ?? `${node.id}-video`, mimeType, 'mp4'),
    };
  }

  if (node.type === 'audioGen') {
    const url = resolveNodeAssetUrl(node);

    if (!url) {
      return undefined;
    }

    const mimeType = inferMimeType(url, node.data.sourceAssetMimeType, 'audio/mpeg');
    return {
      id: `${node.id}:${url.slice(0, 32)}`,
      nodeId: node.id,
      label: node.data.sourceAssetName ?? node.data.voiceId ?? node.data.modelId ?? 'audio',
      url,
      mimeType,
      fileName: buildDownloadFilename(node.data.sourceAssetName ?? `${node.id}-audio`, mimeType, 'mp3'),
    };
  }

  return undefined;
}

function resolveNodeAssetUrl(node: AppNode): string | undefined {
  if (node.type === 'composition') {
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'videoGen' || node.type === 'audioGen') {
    return (node.data.mediaMode ?? 'generate') === 'import'
      ? resultValueAsMediaUrl(node.data.sourceAssetUrl)
      : resultValueAsMediaUrl(node.data.result);
  }

  return undefined;
}

function inferMimeType(url: string, fallback: string | undefined, defaultMimeType: string): string {
  if (fallback) {
    return fallback;
  }

  const match = url.match(/^data:([^;,]+)/);
  return match?.[1] ?? defaultMimeType;
}
