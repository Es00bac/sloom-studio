import { describe, expect, it } from 'vitest';
import { getImageEditorContextMenuPortalTarget } from './ImageEditorContextMenuPortal';

describe('ImageEditorContextMenu', () => {
  it('uses the document body as the viewport-positioned menu portal target', () => {
    const body = {} as HTMLElement;

    expect(getImageEditorContextMenuPortalTarget({ body } as Document)).toBe(body);
  });
});
