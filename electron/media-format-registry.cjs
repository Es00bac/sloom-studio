const MEDIA_FORMAT_REGISTRY = [
  { kind: 'image', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'tif', 'svg', 'psd', 'psb', 'xcf', 'exr', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/svg+xml', 'image/vnd.adobe.photoshop', 'image/x-photoshop', 'image/x-xcf', 'image/x-exr', 'image/exr', 'image/x-adobe-dng', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw', 'image/x-sony-arw', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2', 'image/x-pentax-pef', 'image/x-samsung-srw', 'image/x-sigma-x3f'], preferredMimeTypes: ['image/png', 'image/jpeg', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/tiff', 'image/svg+xml', 'image/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop', 'image/x-xcf', 'image/x-exr', 'image/x-adobe-dng', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw', 'image/x-sony-arw', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2', 'image/x-pentax-pef', 'image/x-samsung-srw', 'image/x-sigma-x3f'] },
  { kind: 'video', label: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'hevc', 'h265'], mimeTypes: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo', 'video/x-m4v', 'video/hevc', 'video/h265'] },
  { kind: 'audio', label: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'aiff', 'aif', 'opus', 'caf', 'wma'], mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/aiff', 'audio/x-aiff', 'audio/opus', 'audio/x-caf', 'audio/x-ms-wma'], preferredMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/aiff', 'audio/x-aiff', 'audio/opus', 'audio/x-caf', 'audio/x-ms-wma'] },
  { kind: 'document', label: 'Documents', extensions: ['txt', 'md', 'rtf', 'docx', 'pdf', 'idml', 'sloom-idml.json', 'html', 'htm', 'epub', 'cbz'], mimeTypes: ['text/plain', 'text/markdown', 'text/rtf', 'application/rtf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 'application/vnd.adobe.indesign-idml-package', 'application/vnd.signal-loom.paper-idml+json', 'text/html', 'application/xhtml+xml', 'application/epub+zip', 'application/vnd.comicbook+zip'], preferredMimeTypes: ['text/plain', 'text/markdown', 'application/rtf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 'application/vnd.adobe.indesign-idml-package', 'application/vnd.signal-loom.paper-idml+json', 'text/html', 'text/html', 'application/epub+zip', 'application/vnd.comicbook+zip'] },
  { kind: 'subtitle', label: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'], mimeTypes: ['application/x-subrip', 'text/vtt', 'text/x-ssa', 'text/x-ass'] },
  { kind: 'package', label: 'Projects & Packages', extensions: ['sloom', 'sloom-paper.json', 'sloom-paper-package.json', 'sloom-paper.package.json', 'sloom-paper-package.zip', 'zip'], mimeTypes: ['application/vnd.signal-loom.project+json', 'application/vnd.signal-loom.paper+json', 'application/vnd.signal-loom.paper-package+json', 'application/vnd.signal-loom.paper-package+json', 'application/zip', 'application/zip', 'application/x-zip-compressed'], preferredMimeTypes: ['application/vnd.signal-loom.project+json', 'application/vnd.signal-loom.paper+json', 'application/vnd.signal-loom.paper-package+json', 'application/vnd.signal-loom.paper-package+json', 'application/zip', 'application/zip'] },
];

function getFileExtension(filePath) {
  const lowerPath = String(filePath ?? '').toLowerCase();
  if (lowerPath.endsWith('.sloom-paper-package.zip')) return 'sloom-paper-package.zip';
  if (lowerPath.endsWith('.sloom-paper-package.json')) return 'sloom-paper-package.json';
  if (lowerPath.endsWith('.sloom-paper.package.json')) return 'sloom-paper.package.json';
  if (lowerPath.endsWith('.sloom-paper.json')) return 'sloom-paper.json';
  if (lowerPath.endsWith('.sloom-idml.json')) return 'sloom-idml.json';
  const match = /\.([^.\\/]+)$/.exec(lowerPath);
  return match?.[1];
}

function getFormatByExtension(extension) {
  const normalized = String(extension ?? '').toLowerCase().replace(/^\.+/, '');
  return MEDIA_FORMAT_REGISTRY.find((format) => format.extensions.includes(normalized));
}

function inferSourceKindFromFile(filePath) {
  return getFormatByExtension(getFileExtension(filePath))?.kind;
}

function inferMimeTypeFromFile(filePath, fallbackKind) {
  const extension = getFileExtension(filePath);
  const format = getFormatByExtension(extension);
  if (format) {
    const index = format.extensions.indexOf(extension);
    const preferredMimeTypes = format.preferredMimeTypes ?? format.mimeTypes;
    return preferredMimeTypes[index] ?? preferredMimeTypes[0];
  }

  return getDefaultMimeTypeForKind(fallbackKind);
}

function getDefaultMimeTypeForKind(kind) {
  switch (kind) {
    case 'image': return 'image/png';
    case 'video':
    case 'composition': return 'video/mp4';
    case 'audio': return 'audio/mpeg';
    case 'document': return 'application/pdf';
    case 'subtitle': return 'text/vtt';
    case 'package': return 'application/zip';
    case 'text': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

function inferDownloadExtension(mimeType, fallbackExtension, kind) {
  const normalized = String(mimeType ?? '').toLowerCase();
  if (normalized === 'application/vnd.signal-loom.paper-package+json') return 'sloom-paper-package.json';
  if (normalized === 'application/zip') return 'zip';
  if (normalized === 'application/x-zip-compressed') return 'zip';
  let preferredExtension;
  for (const format of MEDIA_FORMAT_REGISTRY) {
    const preferredMimeTypes = format.preferredMimeTypes ?? format.mimeTypes;
    preferredMimeTypes.forEach((candidate, index) => {
      if (candidate.toLowerCase() === normalized) {
        preferredExtension = format.extensions[index] ?? format.extensions[0];
      }
    });
  }
  if (preferredExtension) return preferredExtension;
  const byMime = MEDIA_FORMAT_REGISTRY.find((format) => format.mimeTypes.some((candidate) => candidate.toLowerCase() === normalized));
  if (byMime) {
    return byMime.extensions[0];
  }
  const byKind = MEDIA_FORMAT_REGISTRY.find((format) => format.kind === kind);
  return byKind?.extensions[0] ?? fallbackExtension ?? 'bin';
}

function getElectronDialogFilterGroups(kinds) {
  const requestedKinds = Array.isArray(kinds)
    ? new Set(kinds.filter((kind) => typeof kind === 'string'))
    : undefined;
  const formats = requestedKinds?.size
    ? MEDIA_FORMAT_REGISTRY.filter((format) => requestedKinds.has(format.kind))
    : MEDIA_FORMAT_REGISTRY;
  const mediaExtensions = formats
    .filter((format) => ['image', 'video', 'audio'].includes(format.kind))
    .flatMap((format) => format.extensions);
  const allExtensions = formats.flatMap((format) => format.extensions);
  return [
    ...(mediaExtensions.length > 0 ? [{ name: 'Media', extensions: mediaExtensions }] : []),
    ...formats.map((format) => ({ name: format.label, extensions: format.extensions })),
    { name: 'All Supported', extensions: [...new Set(allExtensions)] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

module.exports = {
  MEDIA_FORMAT_REGISTRY,
  getElectronDialogFilterGroups,
  getFileExtension,
  getFormatByExtension,
  getDefaultMimeTypeForKind,
  inferDownloadExtension,
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
};
