import { describe, expect, it } from 'vitest';
import {
  buildPaperFrameAssetFromSourceItem,
  hasPaperAssetReference,
  resolvePaperFrameAssetUrl,
} from './paperAssetReferences';

describe('Paper asset references', () => {
  it('keeps a source-bin data URL out of Paper state while resolving it at runtime', () => {
    const source = {
      id: 'source-1',
      label: 'Panel.png',
      kind: 'image' as const,
      mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,AQID',
      createdAt: 1,
    };
    const asset = buildPaperFrameAssetFromSourceItem(source);

    expect(asset).toMatchObject({ sourceBinItemId: source.id, label: source.label, kind: 'image' });
    expect(JSON.stringify(asset)).not.toMatch(/data:|AQID/);
    expect(hasPaperAssetReference(asset)).toBe(true);
    expect(resolvePaperFrameAssetUrl(asset, source)).toBe(source.assetUrl);
  });

  it('preserves a durable external URL as a locator', () => {
    const source = {
      id: 'source-2',
      label: 'Panel.png',
      kind: 'image' as const,
      mimeType: 'image/png',
      assetUrl: 'https://cdn.example.test/panel.png',
      createdAt: 1,
    };

    const asset = buildPaperFrameAssetFromSourceItem(source);

    expect(asset.locator).toEqual({ kind: 'external', url: source.assetUrl });
    expect(resolvePaperFrameAssetUrl(asset)).toBe(source.assetUrl);
  });

  it('uses the current Source Library URL before a stale supplemental external locator', () => {
    const asset = {
      sourceBinItemId: 'source-3',
      label: 'Panel.png',
      kind: 'image' as const,
      locator: { kind: 'external' as const, url: 'https://cdn.example.test/stale-panel.png' },
    };
    const source = {
      id: 'source-3',
      assetUrl: 'data:image/png;base64,CQgH',
    };

    expect(resolvePaperFrameAssetUrl(asset, source)).toBe(source.assetUrl);
  });

  it('resolves a transient export URL without making it a persisted Paper asset', () => {
    const asset = {
      label: 'Invalid persisted URL',
      kind: 'image' as const,
      locator: { kind: 'external' as const, url: 'data:image/png;base64,AQID' },
    };

    expect(resolvePaperFrameAssetUrl(asset)).toBe('data:image/png;base64,AQID');
  });
});
