import { describe, expect, it } from 'vitest';
import { haneLinkedEditDocumentId } from './haneLinkedEdit';

describe('Hane linked Paper edit identity', () => {
  it('binds the phone canvas to the exact page, frame, and Source Library item', () => {
    expect(haneLinkedEditDocumentId('page-7', 'panel-3', 'source-9'))
      .toBe('hane-paper:page-7:panel-3:source-9');
  });

  it('keeps transport identity bounded for hostile or legacy long ids', () => {
    expect(haneLinkedEditDocumentId('p'.repeat(200), 'f'.repeat(200), 's'.repeat(200)).length)
      .toBeLessThanOrEqual(240);
  });
});
