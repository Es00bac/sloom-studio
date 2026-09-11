import { describe, expect, it } from 'vitest';
import type { SlimgV1CompatibilityReport } from '../../lib/slimgV2';
import { formatSlimgV1CompatibilityReport } from './ImageSlimgCompatibilityReport';

const REPORT: SlimgV1CompatibilityReport = {
  sourceVersion: 2,
  targetVersion: 1,
  flattenedLayers: [{
    layerId: 'shape',
    layerName: 'Shape',
    reasons: ['vector-recipe', 'warp-mesh'],
    fallbackAssetId: 'fallback.png',
  }],
  omittedDocumentFeatures: [{
    feature: 'physical-state',
    detail: 'Physical state is baked into raster fallbacks.',
    assetIds: ['physical.bin'],
  }],
  retainedAssetIds: ['fallback.png'],
  omittedAssetIds: ['font.woff2', 'physical.bin'],
};

describe('formatSlimgV1CompatibilityReport', () => {
  it('reports exact flattened records and assets in English', () => {
    const value = formatSlimgV1CompatibilityReport(REPORT, 'en');
    expect(value).toContain('Shape [shape]: editable vector recipe, mesh warp');
    expect(value).toContain('Raster fallback: fallback.png');
    expect(value).toContain('Physical-media editable state');
    expect(value).toContain('physical.bin');
    expect(value).toContain('font.woff2');
  });

  it('localizes report labels in Japanese without changing identifiers', () => {
    const value = formatSlimgV1CompatibilityReport(REPORT, 'ja');
    expect(value).toContain('Shape [shape]: 編集可能なベクターレシピ、メッシュワープ');
    expect(value).toContain('ラスターフォールバック: fallback.png');
    expect(value).toContain('物理メディアの編集可能な状態');
    expect(value).toContain('physical.bin');
  });
});
