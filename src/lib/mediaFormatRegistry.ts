import type { EditorSourceKind } from '../types/flow';

export type MediaFormatKind = Exclude<EditorSourceKind, 'text' | 'composition'>;

export interface MediaFormatDefinition {
  kind: MediaFormatKind;
  label: string;
  extensions: string[];
  mimeTypes: string[];
  preferredMimeTypes?: string[];
  capabilities: {
    importable: boolean;
    downloadable: boolean;
    previewable: boolean;
    timelineMedia: boolean;
    paperPlaceable: boolean;
    package: boolean;
  };
}

export interface ElectronDialogFilterGroup {
  name: string;
  extensions: string[];
}

export const MEDIA_FORMAT_REGISTRY: MediaFormatDefinition[] = [
  {
    kind: 'image',
    label: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'tif', 'svg', 'psd', 'psb', 'xcf', 'exr', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/svg+xml', 'image/vnd.adobe.photoshop', 'image/x-photoshop', 'image/x-xcf', 'image/x-exr', 'image/exr', 'image/x-adobe-dng', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw', 'image/x-sony-arw', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2', 'image/x-pentax-pef', 'image/x-samsung-srw', 'image/x-sigma-x3f'],
    preferredMimeTypes: ['image/png', 'image/jpeg', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/tiff', 'image/svg+xml', 'image/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop', 'image/x-xcf', 'image/x-exr', 'image/x-adobe-dng', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw', 'image/x-sony-arw', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2', 'image/x-pentax-pef', 'image/x-samsung-srw', 'image/x-sigma-x3f'],
    capabilities: { importable: true, downloadable: true, previewable: true, timelineMedia: true, paperPlaceable: true, package: false },
  },
  {
    kind: 'video',
    label: 'Video',
    extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'hevc', 'h265'],
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo', 'video/x-m4v', 'video/hevc', 'video/h265'],
    capabilities: { importable: true, downloadable: true, previewable: true, timelineMedia: true, paperPlaceable: false, package: false },
  },
  {
    kind: 'audio',
    label: 'Audio',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'aiff', 'aif', 'opus', 'caf', 'wma'],
    mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/aiff', 'audio/x-aiff', 'audio/opus', 'audio/x-caf', 'audio/x-ms-wma'],
    preferredMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/aiff', 'audio/x-aiff', 'audio/opus', 'audio/x-caf', 'audio/x-ms-wma'],
    capabilities: { importable: true, downloadable: true, previewable: false, timelineMedia: true, paperPlaceable: false, package: false },
  },
  {
    kind: 'document',
    label: 'Documents',
    extensions: ['txt', 'md', 'rtf', 'docx', 'pdf', 'idml', 'sloom-idml.json', 'html', 'htm', 'epub', 'cbz'],
    mimeTypes: ['text/plain', 'text/markdown', 'text/rtf', 'application/rtf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 'application/vnd.adobe.indesign-idml-package', 'application/vnd.signal-loom.paper-idml+json', 'text/html', 'application/xhtml+xml', 'application/epub+zip', 'application/vnd.comicbook+zip'],
    preferredMimeTypes: ['text/plain', 'text/markdown', 'application/rtf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 'application/vnd.adobe.indesign-idml-package', 'application/vnd.signal-loom.paper-idml+json', 'text/html', 'text/html', 'application/epub+zip', 'application/vnd.comicbook+zip'],
    capabilities: { importable: true, downloadable: true, previewable: false, timelineMedia: false, paperPlaceable: true, package: false },
  },
  {
    kind: 'subtitle',
    label: 'Subtitles',
    extensions: ['srt', 'vtt', 'ass', 'ssa'],
    mimeTypes: ['application/x-subrip', 'text/vtt', 'text/x-ssa', 'text/x-ass'],
    capabilities: { importable: true, downloadable: true, previewable: false, timelineMedia: false, paperPlaceable: false, package: false },
  },
  {
    kind: 'package',
    label: 'Projects & Packages',
    extensions: ['sloom', 'sloom-paper.json', 'sloom-paper-package.json', 'sloom-paper.package.json', 'sloom-paper-package.zip', 'zip'],
    mimeTypes: ['application/vnd.signal-loom.project+json', 'application/vnd.signal-loom.paper+json', 'application/vnd.signal-loom.paper-package+json', 'application/vnd.signal-loom.paper-package+json', 'application/zip', 'application/zip', 'application/x-zip-compressed'],
    preferredMimeTypes: ['application/vnd.signal-loom.project+json', 'application/vnd.signal-loom.paper+json', 'application/vnd.signal-loom.paper-package+json', 'application/vnd.signal-loom.paper-package+json', 'application/zip', 'application/zip'],
    capabilities: { importable: true, downloadable: true, previewable: false, timelineMedia: false, paperPlaceable: false, package: true },
  },
];

const PREFERRED_MIME_BY_EXTENSION = new Map<string, string>();
const PREFERRED_EXTENSION_BY_MIME = new Map<string, string>();
const FORMAT_BY_EXTENSION = new Map<string, MediaFormatDefinition>();
const FORMAT_BY_MIME = new Map<string, MediaFormatDefinition>();

for (const format of MEDIA_FORMAT_REGISTRY) {
  for (const extension of format.extensions) {
    FORMAT_BY_EXTENSION.set(extension, format);
  }
  const preferredMimeTypes = format.preferredMimeTypes ?? format.mimeTypes;
  format.extensions.forEach((extension, index) => {
    PREFERRED_MIME_BY_EXTENSION.set(extension, preferredMimeTypes[index] ?? preferredMimeTypes[0]);
  });
  preferredMimeTypes.forEach((mimeType, index) => {
    const normalizedMimeType = normalizeMimeType(mimeType);
    if (!normalizedMimeType) return;
    PREFERRED_EXTENSION_BY_MIME.set(normalizedMimeType, format.extensions[index] ?? format.extensions[0]);
  });
  format.mimeTypes.forEach((mimeType) => {
    const normalizedMimeType = normalizeMimeType(mimeType);
    if (!normalizedMimeType) return;
    FORMAT_BY_MIME.set(normalizedMimeType, format);
  });
}

PREFERRED_EXTENSION_BY_MIME.set('audio/mp3', 'mp3');
PREFERRED_EXTENSION_BY_MIME.set('image/jpeg', 'jpg');
PREFERRED_EXTENSION_BY_MIME.set('audio/x-wav', 'wav');
PREFERRED_EXTENSION_BY_MIME.set('audio/x-aiff', 'aiff');
PREFERRED_EXTENSION_BY_MIME.set('application/rtf', 'rtf');
PREFERRED_EXTENSION_BY_MIME.set('application/vnd.signal-loom.paper-package+json', 'sloom-paper-package.json');
PREFERRED_EXTENSION_BY_MIME.set('application/x-zip-compressed', 'zip');

export function normalizeExtension(extension: string | undefined): string | undefined {
  const normalized = extension?.trim().toLowerCase().replace(/^\.+/, '');
  return normalized || undefined;
}

export function getFileExtension(fileNameOrPath: string | undefined): string | undefined {
  if (!fileNameOrPath) return undefined;
  const lowerName = fileNameOrPath.toLowerCase();

  if (lowerName.endsWith('.sloom-paper-package.zip')) return 'sloom-paper-package.zip';
  if (lowerName.endsWith('.sloom-paper-package.json')) return 'sloom-paper-package.json';
  if (lowerName.endsWith('.sloom-paper.package.json')) return 'sloom-paper.package.json';
  if (lowerName.endsWith('.sloom-paper.json')) return 'sloom-paper.json';
  if (lowerName.endsWith('.sloom-idml.json')) return 'sloom-idml.json';

  const match = /\.([^.\\/]+)$/.exec(lowerName);
  return normalizeExtension(match?.[1]);
}

export function normalizeMimeType(mimeType: string | undefined): string | undefined {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

export function getFormatByExtension(extension: string | undefined): MediaFormatDefinition | undefined {
  return FORMAT_BY_EXTENSION.get(normalizeExtension(extension) ?? '');
}

export function getFormatByMimeType(mimeType: string | undefined): MediaFormatDefinition | undefined {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return undefined;

  return FORMAT_BY_MIME.get(normalized) ?? (
    normalized.startsWith('image/') ? getFormatByExtension('png') :
    normalized.startsWith('video/') ? getFormatByExtension('mp4') :
    normalized.startsWith('audio/') ? getFormatByExtension('mp3') :
    undefined
  );
}

export function inferFormatFromFile(fileNameOrPath?: string, mimeType?: string): MediaFormatDefinition | undefined {
  return getFormatByExtension(getFileExtension(fileNameOrPath)) ?? getFormatByMimeType(mimeType);
}

export function inferSourceKindFromFile(fileNameOrPath?: string, mimeType?: string): MediaFormatKind | undefined {
  return inferFormatFromFile(fileNameOrPath, mimeType)?.kind;
}

export function inferMimeTypeFromFile(fileNameOrPath?: string, fallbackKind?: MediaFormatKind): string | undefined {
  const extension = getFileExtension(fileNameOrPath);
  return (extension ? PREFERRED_MIME_BY_EXTENSION.get(extension) : undefined) ?? (fallbackKind ? getDefaultMimeTypeForKind(fallbackKind) : undefined);
}

export function getDefaultMimeTypeForKind(kind: MediaFormatKind | 'text' | 'composition'): string {
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'video':
    case 'composition':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'document':
      return 'application/pdf';
    case 'subtitle':
      return 'text/vtt';
    case 'package':
      return 'application/zip';
    case 'text':
      return 'text/plain';
  }
}

export function inferDownloadExtension(mimeType: string | undefined, fallbackExtension: string, fileNameOrPath?: string): string {
  return getFileExtension(fileNameOrPath)
    ?? PREFERRED_EXTENSION_BY_MIME.get(normalizeMimeType(mimeType) ?? '')
    ?? getFormatByMimeType(mimeType)?.extensions[0]
    ?? normalizeExtension(fallbackExtension)
    ?? 'bin';
}

export function getAcceptStringForKinds(kinds: readonly MediaFormatKind[]): string {
  const tokens = new Set<string>();
  for (const kind of kinds) {
    const format = MEDIA_FORMAT_REGISTRY.find((candidate) => candidate.kind === kind);
    if (!format) continue;
    for (const mimeType of format.mimeTypes) tokens.add(mimeType);
    for (const extension of format.extensions) tokens.add(`.${extension}`);
  }
  return [...tokens].join(',');
}

export function getAcceptStringForAllImportableFormats(): string {
  return getAcceptStringForKinds(MEDIA_FORMAT_REGISTRY.filter((format) => format.capabilities.importable).map((format) => format.kind));
}

export function canBrowserPreviewMedia(fileNameOrPath: string | undefined, mimeType: string | undefined): boolean {
  const format = inferFormatFromFile(fileNameOrPath, mimeType);

  if (!format || (format.kind !== 'video' && format.kind !== 'audio')) {
    return Boolean(format?.capabilities.previewable);
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const element = document.createElement(format.kind);
  const candidateMimeType = normalizeMimeType(mimeType) ?? inferMimeTypeFromFile(fileNameOrPath, format.kind);

  if (!candidateMimeType) {
    return false;
  }

  return element.canPlayType(candidateMimeType) !== '';
}

export function getBrowserPreviewSupportLabel(fileNameOrPath: string | undefined, mimeType: string | undefined): string | undefined {
  const format = inferFormatFromFile(fileNameOrPath, mimeType);

  if (!format || (format.kind !== 'video' && format.kind !== 'audio')) {
    return undefined;
  }

  return canBrowserPreviewMedia(fileNameOrPath, mimeType)
    ? 'Browser preview supported'
    : 'Imported for native/FFmpeg use; browser preview may be unsupported';
}

export function isGifMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType) === 'image/gif';
}

/**
 * True when an image asset reference is a GIF -- the signal the Video timeline uses to decide
 * whether an "image" clip might actually be a (possibly animated) GIF that needs frame-aware
 * handling instead of being treated as one static picture. Prefers an explicit `mimeType` (the
 * only reliable signal for `blob:` asset URLs, which carry no usable file extension) and only
 * falls back to sniffing the URL when no mimeType is known, checking the `data:` URL's own MIME
 * type before the trailing file extension.
 */
export function isGifAssetReference(assetUrl: string | undefined, mimeType: string | undefined): boolean {
  if (mimeType) {
    return isGifMimeType(mimeType);
  }

  if (!assetUrl) {
    return false;
  }

  const dataUrlMatch = /^data:([^;,]+)/i.exec(assetUrl);
  if (dataUrlMatch) {
    return isGifMimeType(dataUrlMatch[1]);
  }

  const pathOnly = assetUrl.split(/[?#]/)[0];
  return getFileExtension(pathOnly) === 'gif';
}

export function getElectronDialogFilterGroups(): ElectronDialogFilterGroup[] {
  const mediaExtensions = getExtensionsForKinds(['image', 'video', 'audio']);
  const allExtensions = MEDIA_FORMAT_REGISTRY.flatMap((format) => format.extensions);
  return [
    { name: 'Media', extensions: mediaExtensions },
    ...MEDIA_FORMAT_REGISTRY.map((format) => ({ name: format.label, extensions: format.extensions })),
    { name: 'All Supported', extensions: [...new Set(allExtensions)] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

function getExtensionsForKinds(kinds: readonly MediaFormatKind[]): string[] {
  return MEDIA_FORMAT_REGISTRY
    .filter((format) => kinds.includes(format.kind))
    .flatMap((format) => format.extensions);
}
