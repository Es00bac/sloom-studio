import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export interface ContainerManifest {
  format: string;
  formatVersion: number;
  kind: string;
  document: unknown;
  assets: string[];
  [extra: string]: unknown;
}

export function packContainer(
  manifest: ContainerManifest,
  assets: Map<string, Uint8Array>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
  };
  for (const [id, data] of assets) {
    files['assets/' + id] = data;
  }
  return zipSync(files, { level: 6 });
}

export function unpackContainer(bytes: Uint8Array): {
  manifest: ContainerManifest;
  assets: Map<string, Uint8Array>;
} {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('SignalLoomContainer: not a valid zip');
  }

  if (!entries['manifest.json']) {
    throw new Error('SignalLoomContainer: missing manifest.json');
  }

  let manifest: ContainerManifest;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json'])) as ContainerManifest;
  } catch {
    throw new Error('SignalLoomContainer: invalid manifest JSON');
  }

  if (typeof manifest.format !== 'string' || typeof manifest.formatVersion !== 'number') {
    throw new Error('SignalLoomContainer: manifest missing format/formatVersion');
  }

  const assetMap = new Map<string, Uint8Array>();
  for (const path of Object.keys(entries)) {
    if (path.startsWith('assets/')) {
      assetMap.set(path.slice('assets/'.length), entries[path]);
    }
  }

  return { manifest, assets: assetMap };
}
