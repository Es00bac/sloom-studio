import type { EditorSourceKind } from '../types/flow';

export type ImportedMediaKind = Exclude<EditorSourceKind, 'text' | 'composition'>;

export interface ImportedMediaBatchNormalizationRequestItem {
  filePath: string;
  label?: string;
  kind?: ImportedMediaKind;
  mimeType?: string;
}

export interface NormalizedImportedMediaBatchItem {
  filePath: string;
  label: string;
  kind: ImportedMediaKind;
  mimeType: string;
}

export async function normalizeImportedMediaBatch(
  items: ImportedMediaBatchNormalizationRequestItem[],
): Promise<NormalizedImportedMediaBatchItem[]> {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.flatMap((item) => {
    const filePath = typeof item?.filePath === 'string' ? item.filePath.trim() : '';
    const kind = isImportedMediaKind(item?.kind) ? item.kind : undefined;

    if (!filePath || !kind) {
      return [];
    }

    return [{
      filePath,
      label: getNormalizedImportLabel(item?.label, filePath),
      kind,
      mimeType: typeof item?.mimeType === 'string' && item.mimeType.trim()
        ? item.mimeType.trim()
        : 'application/octet-stream',
    }];
  });
}

function isImportedMediaKind(value: unknown): value is ImportedMediaKind {
  return value === 'image'
    || value === 'video'
    || value === 'audio'
    || value === 'document'
    || value === 'subtitle'
    || value === 'package';
}

function getNormalizedImportLabel(label: unknown, filePath: string): string {
  if (typeof label === 'string' && label.trim()) {
    return label.trim();
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1).trim();
  return fileName || filePath;
}
