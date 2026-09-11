import { describe, expect, it } from 'vitest';
import {
  getMediaPreviewTitle,
  getMediaPreviewViewportClassName,
} from './mediaPreview';

describe('getMediaPreviewTitle', () => {
  it('uses the media label when available and falls back by kind', () => {
    expect(getMediaPreviewTitle('image', 'Hero still')).toBe('Hero still preview');
    expect(getMediaPreviewTitle('video')).toBe('Video preview');
  });
});

describe('getMediaPreviewViewportClassName', () => {
  it('caps image and video previews around a 720p display size', () => {
    expect(getMediaPreviewViewportClassName()).toContain('max-h-[720px]');
    expect(getMediaPreviewViewportClassName()).toContain('max-w-[1280px]');
  });
});
