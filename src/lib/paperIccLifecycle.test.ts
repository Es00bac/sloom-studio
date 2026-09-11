import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument } from './paperDocument';
import { exportPaperDocumentToPdfx, type PaperPdfxPipelineDeps } from './paperPdfxPipeline';
import {
  disposeOwnedPaperResources,
  getPaperResourceCleanupError,
  PaperResourcePrimaryAndCleanupError,
  usingOwnedPaperResource,
  type IccCmykTransform,
} from './paperColorManagement';
import type { PaperOutputProfileResolution } from './paperManagedIccProfiles';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';

type Assert<T extends true> = T;
type PipelineOwnedTransform = Awaited<ReturnType<PaperPdfxPipelineDeps['createTransform']>>;
type PipelineBorrowedTransform = Omit<PipelineOwnedTransform, 'dispose'> & { dispose?: () => void };
/** PDF/X takes ownership, so an otherwise-identical optional disposer cannot satisfy its dependency. */
void (true satisfies Assert<
  PipelineBorrowedTransform extends PipelineOwnedTransform ? false : true
>);

type FailurePoint = 'create-srgb' | 'open-cmyk' | 'wrong-space' | 'create-transform' | 'create-proofing-transform';

interface LifecycleStats {
  createdProfiles: number;
  closedProfiles: number;
  createdTransforms: number;
  deletedTransforms: number;
  deleteTransformAttempts: number;
  closeProfileAttempts: number;
  outstandingProfiles(): number;
  outstandingTransforms(): number;
}

function createTrackedLcms(input: { failure?: FailurePoint; throwDuringCleanup?: boolean; failDeleteTransform?: boolean } = {}): { module: Record<string, unknown>; stats: LifecycleStats } {
  const { failure, throwDuringCleanup = false, failDeleteTransform = false } = input;
  let nextProfile = 1;
  let nextTransform = 100;
  const profiles = new Set<number>();
  const transforms = new Set<number>();
  const stats: LifecycleStats = {
    createdProfiles: 0,
    closedProfiles: 0,
    createdTransforms: 0,
    deletedTransforms: 0,
    deleteTransformAttempts: 0,
    closeProfileAttempts: 0,
    outstandingProfiles: () => profiles.size,
    outstandingTransforms: () => transforms.size,
  };
  const createProfile = () => {
    const handle = nextProfile++;
    profiles.add(handle);
    stats.createdProfiles += 1;
    return handle;
  };
  const createTransform = () => {
    const handle = nextTransform++;
    transforms.add(handle);
    stats.createdTransforms += 1;
    return handle;
  };
  return {
    stats,
    module: {
      cmsCreate_sRGBProfile: () => failure === 'create-srgb' ? 0 : createProfile(),
      cmsOpenProfileFromMem: () => failure === 'open-cmyk' ? 0 : createProfile(),
      cmsGetColorSpaceASCII: () => failure === 'wrong-space' ? 'RGB' : 'CMYK',
      cmsCreateTransform: () => failure === 'create-transform' ? 0 : createTransform(),
      cmsCreateProofingTransform: () => failure === 'create-proofing-transform' ? 0 : createTransform(),
      cmsGetProfileInfoASCII: () => 'Tracked CMYK',
      cmsDoTransform: (_handle: number, bytes: Uint8Array) => new Uint8Array(bytes),
      cmsDeleteTransform: (handle: number) => {
        stats.deleteTransformAttempts += 1;
        // A failed delete does not relinquish the handle. The fake deliberately throws before
        // mutating its ownership set so lifecycle tests can detect false-success accounting.
        if (throwDuringCleanup || failDeleteTransform) throw new Error('delete transform failed');
        if (transforms.delete(handle)) stats.deletedTransforms += 1;
      },
      cmsCloseProfile: (handle: number) => {
        stats.closeProfileAttempts += 1;
        if (throwDuringCleanup) throw new Error('close profile failed');
        if (profiles.delete(handle)) stats.closedProfiles += 1;
      },
    },
  };
}

const mockedLcms = vi.hoisted(() => ({ module: undefined as Record<string, unknown> | undefined }));

vi.mock('lcms-wasm', () => ({
  TYPE_CMYK_8: 0,
  TYPE_RGB_8: 0,
  cmsInfoDescription: 0,
  instantiate: async () => mockedLcms.module,
}));

async function loadEngine(module: Record<string, unknown>) {
  mockedLcms.module = module;
  vi.resetModules();
  return import('./paperIccEngine');
}

afterEach(() => {
  mockedLcms.module = undefined;
  vi.resetModules();
});

describe('AUD-038 ICC ownership lifecycle (red baseline)', () => {
  it('balances all RGB-to-CMYK profile and transform handles across repeated conversions', async () => {
    const tracked = createTrackedLcms();
    const { createRgbToCmykTransform } = await loadEngine(tracked.module);

    for (let index = 0; index < 100; index += 1) {
      const transform = await createRgbToCmykTransform(new Uint8Array([1]));
      transform.rgbToCmyk({ r: index, g: 20, b: 30 });
      (transform as { dispose?: () => void }).dispose?.();
    }

    expect(tracked.stats.outstandingTransforms()).toBe(0);
    expect(tracked.stats.outstandingProfiles()).toBe(0);
  });

  it.each<FailurePoint>(['create-srgb', 'open-cmyk', 'wrong-space', 'create-transform'])(
    'releases all partially-created RGB-to-CMYK handles when %s fails',
    async (failure) => {
      const tracked = createTrackedLcms({ failure });
      const { createRgbToCmykTransform } = await loadEngine(tracked.module);

      await expect(createRgbToCmykTransform(new Uint8Array([1]))).rejects.toThrow();

      expect(tracked.stats.outstandingTransforms()).toBe(0);
      expect(tracked.stats.outstandingProfiles()).toBe(0);
    },
  );

  it.each<FailurePoint>(['create-srgb', 'open-cmyk', 'wrong-space', 'create-transform'])(
    'releases all validation handles when %s fails',
    async (failure) => {
      const tracked = createTrackedLcms({ failure });
      const { validateCmykOutputProfileTransform } = await loadEngine(tracked.module);

      await expect(validateCmykOutputProfileTransform(new Uint8Array([1]))).rejects.toThrow();

      expect(tracked.stats.outstandingTransforms()).toBe(0);
      expect(tracked.stats.outstandingProfiles()).toBe(0);
    },
  );

  it.each<FailurePoint>(['create-srgb', 'open-cmyk', 'wrong-space', 'create-proofing-transform'])(
    'releases all partially-created soft-proof handles when %s fails',
    async (failure) => {
      const tracked = createTrackedLcms({ failure });
      const { createSoftProofTransform } = await loadEngine(tracked.module);

      await expect(createSoftProofTransform(new Uint8Array([1]))).rejects.toThrow();

      expect(tracked.stats.outstandingTransforms()).toBe(0);
      expect(tracked.stats.outstandingProfiles()).toBe(0);
    },
  );

  it('balances all soft-proof profile and transform handles across repeated previews', async () => {
    const tracked = createTrackedLcms();
    const { createSoftProofTransform } = await loadEngine(tracked.module);

    for (let index = 0; index < 100; index += 1) {
      const proof = await createSoftProofTransform(new Uint8Array([1]));
      proof.proofRgb({ r: index, g: 20, b: 30 });
      proof.dispose();
    }

    expect(tracked.stats.outstandingTransforms()).toBe(0);
    expect(tracked.stats.outstandingProfiles()).toBe(0);
  });

  it('keeps a failed deletion outstanding while later owned handles are attempted and released', async () => {
    const tracked = createTrackedLcms({ failDeleteTransform: true });
    const { createRgbToCmykTransform } = await loadEngine(tracked.module);
    const transform = await createRgbToCmykTransform(new Uint8Array([1]));

    expect(() => transform.dispose()).toThrow(/Failed to release 1 Paper native\/WASM resource/);
    expect(tracked.stats.deleteTransformAttempts).toBe(1);
    expect(tracked.stats.closeProfileAttempts).toBe(2);
    expect(tracked.stats.outstandingTransforms()).toBe(1);
    expect(tracked.stats.outstandingProfiles()).toBe(0);
  });

  it('makes disposal idempotent while attempting every owned handle exactly once', async () => {
    const tracked = createTrackedLcms();
    const { createRgbToCmykTransform } = await loadEngine(tracked.module);
    const transform = await createRgbToCmykTransform(new Uint8Array([1]));

    transform.dispose();
    transform.dispose();

    expect(tracked.stats.deleteTransformAttempts).toBe(1);
    expect(tracked.stats.closeProfileAttempts).toBe(2);
    expect(tracked.stats.outstandingTransforms()).toBe(0);
    expect(tracked.stats.outstandingProfiles()).toBe(0);
  });

  it('preserves the primary creation error while retaining cleanup failure details', async () => {
    const tracked = createTrackedLcms({ failure: 'create-transform', throwDuringCleanup: true });
    const { createRgbToCmykTransform } = await loadEngine(tracked.module);

    let thrown: unknown;
    try {
      await createRgbToCmykTransform(new Uint8Array([1]));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not create the ICC color transform.');
    const { getPaperResourceCleanupError: getCleanupForEngine } = await import('./paperColorManagement');
    expect(getCleanupForEngine(thrown)?.failures).toHaveLength(2);
    expect(tracked.stats.outstandingTransforms()).toBe(0);
    // Cleanup was attempted but the fake correctly leaves handles outstanding when their native
    // deletion throws before releasing ownership.
    expect(tracked.stats.outstandingProfiles()).toBe(2);
  });
});

describe('AUD-038 cleanup evidence is side-channelled and merged', () => {
  it.each([
    Object.freeze(new Error('frozen primary')),
    Object.preventExtensions(new Error('non-extensible primary')),
  ])('preserves a non-mutable primary Error identity with cleanup evidence', async (primary) => {
    let thrown: unknown;
    try {
      await usingOwnedPaperResource({ dispose: () => { throw new Error('cleanup failure'); } }, () => { throw primary; });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(primary);
    expect((thrown as Error).message).toBe(primary.message);
    expect(getPaperResourceCleanupError(thrown)?.failures.map((failure) => (failure as Error).message)).toEqual(['cleanup failure']);
  });

  it('makes a primitive primary unmistakable while retaining it as the explicit cause', async () => {
    let thrown: unknown;
    try {
      await usingOwnedPaperResource({ dispose: () => { throw new Error('cleanup failure'); } }, () => { throw 'primitive primary'; });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaperResourcePrimaryAndCleanupError);
    expect((thrown as PaperResourcePrimaryAndCleanupError).primaryError).toBe('primitive primary');
    expect((thrown as Error & { cause?: unknown }).cause).toBe('primitive primary');
    expect(getPaperResourceCleanupError(thrown)?.failures.map((failure) => (failure as Error).message)).toEqual(['cleanup failure']);
  });

  it('merges nested cleanup failures in deterministic resource order without masking the primary', async () => {
    const primary = new Error('primary failure');
    let thrown: unknown;
    try {
      await usingOwnedPaperResource({ dispose: () => { throw new Error('outer cleanup'); } }, async () => {
        await usingOwnedPaperResource({
          dispose: () => disposeOwnedPaperResources([
            { dispose: () => { throw new Error('inner cleanup one'); } },
            { dispose: () => { throw new Error('inner cleanup two'); } },
          ]),
        }, () => { throw primary; });
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(primary);
    expect(getPaperResourceCleanupError(thrown)?.failures.map((failure) => (failure as Error).message)).toEqual([
      'inner cleanup one', 'inner cleanup two', 'outer cleanup',
    ]);
  });
});

const profileId = `sha256:${'1'.repeat(64)}` as BinaryAssetId;
const outputProfile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
  status: 'ready',
  profile: {
    id: profileId,
    asset: { id: profileId, sha256: '1'.repeat(64), mimeType: 'application/vnd.iccprofile', byteLength: 1 },
    description: 'Tracked CMYK',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'TRACKED',
    source: { kind: 'user-import' },
  },
  bytes: new Uint8Array([1]),
};

describe('AUD-038 PDF/X transform ownership (red baseline)', () => {
  it('releases every pipeline-owned transform after repeated flattened PDF/X exports', async () => {
    let outstanding = 0;
    const document = createDefaultPaperDocument({ title: 'Owned pipeline transform' });
    for (let index = 0; index < 50; index += 1) {
      await exportPaperDocumentToPdfx(document, {
        standard: 'pdf-x-1a', outputProfile, flattenAllPages: true, outputDpi: 72,
      }, {
        createTransform: async () => {
          outstanding += 1;
          return {
            kind: 'icc' as const,
            profileName: 'Tracked CMYK',
            rgbToCmyk: () => ({ c: 0, m: 0, y: 0, k: 0 }),
            transformRgbBuffer: (_rgb, pixelCount) => new Uint8Array(pixelCount * 4),
            dispose: () => { outstanding -= 1; },
          };
        },
        rasterizePage: async () => ({ rgba: new Uint8Array([255, 255, 255, 255]), widthPx: 1, heightPx: 1 }),
      });
      expect(outstanding).toBe(0);
    }
  });

  it('releases the owned transform when rasterization fails after transform creation', async () => {
    let outstanding = 0;
    const document = createDefaultPaperDocument({ title: 'Failed owned pipeline transform' });

    await expect(exportPaperDocumentToPdfx(document, {
      standard: 'pdf-x-1a', outputProfile, flattenAllPages: true,
    }, {
      createTransform: async () => {
        outstanding += 1;
        return {
          kind: 'icc' as const,
          profileName: 'Tracked CMYK',
          rgbToCmyk: () => ({ c: 0, m: 0, y: 0, k: 0 }),
          dispose: () => { outstanding -= 1; },
        };
      },
      rasterizePage: async () => { throw new Error('raster failed'); },
    })).rejects.toThrow('raster failed');

    expect(outstanding).toBe(0);
  });

  it('rejects a runtime dependency that violates the required owned-transform disposal contract', async () => {
    const document = createDefaultPaperDocument({ title: 'Missing owned transform disposal' });
    const borrowedTransform: IccCmykTransform = {
      kind: 'icc', profileName: 'Borrowed', rgbToCmyk: () => ({ c: 0, m: 0, y: 0, k: 0 }),
    };

    await expect(exportPaperDocumentToPdfx(document, {
      standard: 'pdf-x-1a', outputProfile, flattenAllPages: true,
    }, {
      createTransform: async () => borrowedTransform as PipelineOwnedTransform,
      rasterizePage: async () => ({ rgba: new Uint8Array([255, 255, 255, 255]), widthPx: 1, heightPx: 1 }),
    })).rejects.toThrow(/fresh owned transform with dispose/i);
  });

});
