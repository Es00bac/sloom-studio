import { describe, expect, it } from 'vitest';
import {
  buildProxyJobSpecifications,
  buildUsedMediaConsolidationPlan,
  planBatchRelink,
  resolveMediaForOperation,
  verifyProfessionalMediaAssets,
  type ProfessionalMediaAsset,
} from './videoProfessionalMedia';

function asset(id = 'asset-a'): ProfessionalMediaAsset {
  return {
    id,
    label: 'Camera A',
    kind: 'video',
    original: {
      locator: { capabilityHandle: `original:${id}`, displayPath: `/RAID/${id}.mov` },
      fingerprint: { fileName: 'A001.mov', byteSize: 10_000, durationMs: 60_000, contentHash: 'SHA256:A' },
    },
    proxy: {
      locator: { capabilityHandle: `proxy:${id}` },
      fingerprint: { fileName: 'A001_proxy.mov', byteSize: 1_000, durationMs: 60_000, contentHash: 'SHA256:P' },
      codec: 'prores-proxy', widthPx: 960, heightPx: 540,
    },
  };
}

describe('professional media verification and resolution', () => {
  it('uses a verified proxy for preview but always the verified original for export', () => {
    const media = asset();
    const [verified] = verifyProfessionalMediaAssets([media], [
      { capabilityHandle: 'original:asset-a', exists: true, byteSize: 10_000, durationMs: 60_000, contentHash: 'sha256:a' },
      { capabilityHandle: 'proxy:asset-a', exists: true, byteSize: 1_000, durationMs: 60_000, contentHash: 'sha256:p' },
    ]);
    expect(resolveMediaForOperation(media, verified, 'preview')).toMatchObject({ role: 'proxy' });
    expect(resolveMediaForOperation(media, verified, 'export')).toMatchObject({ role: 'original' });
  });

  it('refuses proxy substitution when the original is offline at export', () => {
    const media = asset();
    const [verified] = verifyProfessionalMediaAssets([media], [
      { capabilityHandle: 'original:asset-a', exists: false },
      { capabilityHandle: 'proxy:asset-a', exists: true, byteSize: 1_000 },
    ]);
    expect(resolveMediaForOperation(media, verified, 'export')).toMatchObject({ role: 'unavailable' });
    expect(resolveMediaForOperation(media, verified, 'export').reason).toMatch(/never substitutes a proxy/);
  });

  it('reports stale fingerprints and unknown capability observations', () => {
    const media = asset();
    const [verified] = verifyProfessionalMediaAssets([media], [
      { capabilityHandle: 'original:asset-a', exists: true, byteSize: 9_999 },
    ]);
    expect(verified.original.state).toBe('stale');
    expect(verified.proxy?.state).toBe('unverified');
  });
});

describe('deterministic relinking', () => {
  it('prefers exact hashes over metadata and sorts ambiguous candidate ids', () => {
    const decisions = planBatchRelink([asset()], [
      { id: 'z', locator: { capabilityHandle: 'z' }, fingerprint: { fileName: 'other.mov', byteSize: 1, contentHash: 'sha256:a' } },
      { id: 'a', locator: { capabilityHandle: 'a' }, fingerprint: { fileName: 'other2.mov', byteSize: 2, contentHash: 'SHA256:A' } },
      { id: 'metadata-only', locator: { capabilityHandle: 'm' }, fingerprint: { fileName: 'A001.mov', byteSize: 10_000, durationMs: 60_000 } },
    ]);
    expect(decisions[0]).toEqual({ assetId: 'asset-a', status: 'ambiguous', candidateIds: ['a', 'z'], basis: 'exact-hash' });
  });

  it('falls back to exact name, size, and duration and does not guess when tied', () => {
    const withoutHash = asset();
    withoutHash.original.fingerprint.contentHash = undefined;
    expect(planBatchRelink([withoutHash], [
      { id: 'only', locator: { capabilityHandle: 'candidate' }, fingerprint: { fileName: 'a001.MOV', byteSize: 10_000, durationMs: 60_020 } },
    ])[0]).toMatchObject({ status: 'matched', candidateId: 'only', basis: 'name-size-duration' });
    expect(planBatchRelink([withoutHash], [
      { id: 'b', locator: { capabilityHandle: 'b' }, fingerprint: { fileName: 'A001.mov', byteSize: 10_000, durationMs: 60_000 } },
      { id: 'a', locator: { capabilityHandle: 'a' }, fingerprint: { fileName: 'A001.mov', byteSize: 10_000, durationMs: 60_000 } },
    ])[0]).toMatchObject({ status: 'ambiguous', candidateIds: ['a', 'b'] });
    expect(planBatchRelink([asset()], [{
      id: 'wrong-content', locator: { capabilityHandle: 'wrong' },
      fingerprint: { fileName: 'A001.mov', byteSize: 10_000, durationMs: 60_000, contentHash: 'sha256:different' },
    }])[0]).toMatchObject({ status: 'unmatched' });
  });
});

describe('proxy and consolidation planning', () => {
  it('builds bounded even-sized proxy jobs with explicit host capabilities', () => {
    const plan = buildProxyJobSpecifications(
      [{ asset: asset(), sourceWidthPx: 3840, sourceHeightPx: 2160 }],
      { codec: 'prores-proxy', scale: 0.5, maxWidthPx: 1280 },
      { codecs: ['prores-proxy'], maxWidthPx: 1920, maxHeightPx: 1080, maxConcurrentJobs: 32 },
    );
    expect(plan.concurrency).toBe(8);
    expect(plan.jobs[0]).toMatchObject({ widthPx: 1280, heightPx: 720, sourceCapabilityHandle: 'original:asset-a' });
    expect(plan.jobs[0].requiredCapabilities).toContain('encode:prores-proxy');
    expect(() => buildProxyJobSpecifications([], { codec: 'h264', scale: 0.05 }, {
      codecs: ['prores-proxy'], maxWidthPx: 1920, maxHeightPx: 1080, maxConcurrentJobs: 1,
    })).toThrow(/not supported|scale/);
  });

  it('creates a collision-safe, used-original-only plan without performing I/O', () => {
    const second = asset('asset-b');
    const plan = buildUsedMediaConsolidationPlan({
      assets: [asset(), second, asset('unused')],
      usedAssetIds: new Set(['asset-a', 'asset-b']),
      targetDirectory: 'Media/Used',
      targetCapabilityHandle: 'project-media-dir',
    });
    expect(plan.performsIo).toBe(false);
    expect(plan.entries.map((entry) => entry.targetProjectRelativePath)).toEqual([
      'Media/Used/A001.mov', 'Media/Used/A001 (2).mov',
    ]);
    expect(plan.entries[0].sourceCapabilityHandle).toBe('original:asset-a');
    expect(plan.skippedAssetIds).toEqual(['unused']);
    expect(() => buildUsedMediaConsolidationPlan({
      assets: [], usedAssetIds: new Set(), targetDirectory: '../escape', targetCapabilityHandle: 'x',
    })).toThrow(/project-relative/);
  });
});
