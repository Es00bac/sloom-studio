import { describe, expect, it } from 'vitest';
import {
  LARGE_BROWSER_MEDIA_LINK_THRESHOLD_BYTES,
  MAX_INLINE_MEDIA_RECOVERY_BYTES,
  canInlineFailedMediaImport,
  shouldSessionLinkBrowserMedia,
} from './browserMediaIngestPolicy';

describe('browser media ingest policy', () => {
  it('session-links large video without first duplicating it into browser storage', () => {
    expect(shouldSessionLinkBrowserMedia({
      fileSize: LARGE_BROWSER_MEDIA_LINK_THRESHOLD_BYTES,
      hasScratchDirectory: false,
      kind: 'video',
    })).toBe(true);
  });

  it('keeps scratch-backed and small imports durable', () => {
    expect(shouldSessionLinkBrowserMedia({
      fileSize: LARGE_BROWSER_MEDIA_LINK_THRESHOLD_BYTES,
      hasScratchDirectory: true,
      kind: 'video',
    })).toBe(false);
    expect(shouldSessionLinkBrowserMedia({
      fileSize: 20 * 1024 * 1024,
      hasScratchDirectory: false,
      kind: 'video',
    })).toBe(false);
  });

  it('never base64-inlines a very large failed import', () => {
    expect(canInlineFailedMediaImport(MAX_INLINE_MEDIA_RECOVERY_BYTES)).toBe(true);
    expect(canInlineFailedMediaImport(MAX_INLINE_MEDIA_RECOVERY_BYTES + 1)).toBe(false);
  });
});
