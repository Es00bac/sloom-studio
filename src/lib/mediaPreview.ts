export type MediaPreviewKind = 'image' | 'video';

export function getMediaPreviewTitle(kind: MediaPreviewKind, label?: string): string {
  const normalizedLabel = label?.trim();

  if (normalizedLabel) {
    return `${normalizedLabel} preview`;
  }

  return `${kind[0].toUpperCase()}${kind.slice(1)} preview`;
}

export function getMediaPreviewViewportClassName(): string {
  return 'max-h-[720px] max-w-[1280px]';
}
