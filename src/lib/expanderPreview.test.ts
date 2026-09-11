import { describe, expect, it } from 'vitest';
import { getExpanderPreviewKind } from './expanderPreview';

describe('expander preview helpers', () => {
  it('shows thumbnails only for image and video expander items with media values', () => {
    expect(getExpanderPreviewKind({ kind: 'image', value: 'data:image/png;base64,AAA' })).toBe('image');
    expect(getExpanderPreviewKind({ kind: 'video', value: 'data:video/mp4;base64,BBB' })).toBe('video');
    expect(getExpanderPreviewKind({ kind: 'audio', value: 'data:audio/mpeg;base64,CCC' })).toBeUndefined();
    expect(getExpanderPreviewKind({ kind: 'image', value: '' })).toBeUndefined();
  });
});
