import { describe, expect, it } from 'vitest';
import { rebindNodeOutputAssetsToSourceBin } from './flowNodeResultRestore';

describe('named output asset restoration', () => {
  it('rebinds a saved caption output to the source library URL created on reopen', () => {
    const outputs = rebindNodeOutputAssetsToSourceBin({
      'captions-vtt': {
        result: 'blob:dead-before-reopen',
        resultType: 'text',
        assetKind: 'subtitle',
        sourceBinItemId: 'subtitle-1',
        mimeType: 'text/vtt',
      },
    }, [{
      id: 'subtitle-1',
      label: 'captions.vtt',
      kind: 'subtitle',
      mimeType: 'text/vtt',
      assetUrl: 'blob:live-after-reopen',
      createdAt: 1,
    }]);

    expect(outputs?.['captions-vtt']).toMatchObject({
      result: 'blob:live-after-reopen',
      assetKind: 'subtitle',
      sourceBinItemId: 'subtitle-1',
      mimeType: 'text/vtt',
    });
  });
});
