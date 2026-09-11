import type { EditorSourceKind } from '../types/flow';

export const LARGE_BROWSER_MEDIA_LINK_THRESHOLD_BYTES = 512 * 1024 * 1024;
export const MAX_INLINE_MEDIA_RECOVERY_BYTES = 32 * 1024 * 1024;

export function shouldSessionLinkBrowserMedia({
  fileSize,
  hasScratchDirectory,
  kind,
}: {
  fileSize: number;
  hasScratchDirectory: boolean;
  kind: EditorSourceKind;
}): boolean {
  return !hasScratchDirectory
    && (kind === 'video' || kind === 'audio')
    && Number.isFinite(fileSize)
    && fileSize >= LARGE_BROWSER_MEDIA_LINK_THRESHOLD_BYTES;
}

export function canInlineFailedMediaImport(fileSize: number): boolean {
  return Number.isFinite(fileSize) && fileSize >= 0 && fileSize <= MAX_INLINE_MEDIA_RECOVERY_BYTES;
}
