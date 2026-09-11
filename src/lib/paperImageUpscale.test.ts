import { describe, expect, it } from 'vitest';
import type { PaperDocument, PaperFrame } from '../types/paper';
import { createDefaultPaperDocument } from './paperDocument';
import { createPaperComicSfxDesign } from './paperComicSfx';
import {
  buildPaperPrintUpscaledFramePatch,
  buildPaperManagedPrintUpscaledFramePatch,
  buildPaperPrintUpscaleUsageTelemetry,
  collectPaperPrintUpscaleFrameJobs,
  describePaperPrintUpscaleBusyProvider,
  estimatePaperPrintUpscaleCostUsd,
  formatPaperPrintUpscaleProgress,
  isPaperFramePrintReady,
  resolvePaperPrintUpscalePlan,
  resolvePaperPrintUpscaleTarget,
  isPaperPrintUpscaleSkippable,
  shouldUseVertexImagenPrintUpscale,
  resolveVertexImagenUpscaleFactor,
} from './paperImageUpscale';

function doc(dpi = 300): PaperDocument {
  return {
    ...createDefaultPaperDocument(),
    page: {
      ...createDefaultPaperDocument().page,
      dpi,
    },
  };
}

function frame(overrides: Partial<PaperFrame> = {}): PaperFrame {
  return {
    id: 'frame-1',
    kind: 'image',
    label: 'Image Frame',
    xMm: 0,
    yMm: 0,
    widthMm: 100,
    heightMm: 50,
    rotationDeg: 0,
    locked: false,
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    columns: 1,
    typography: {
      fontFamily: 'Inter',
      fontSizePt: 10,
      leadingPt: 13,
      tracking: 0,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    fillColor: 'transparent',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'top',
    zIndex: 0,
    ...overrides,
  };
}

describe('paperImageUpscale', () => {
  it('computes cover targets from the visible print frame and source aspect', () => {
    expect(resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    })).toMatchObject({
      sourceWidthPx: 600,
      sourceHeightPx: 400,
      targetWidthPx: 1181,
      targetHeightPx: 788,
      needsUpscale: true,
    });
  });

  it('uses the contained image footprint for contain instead of the full frame', () => {
    expect(resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'contain',
    }), {
      widthPx: 600,
      heightPx: 400,
    })).toMatchObject({
      targetWidthPx: 887,
      targetHeightPx: 591,
      needsUpscale: true,
    });
  });

  it('scales up the print target when an image crop offset hides visible pixels', () => {
    const centered = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 100,
      fit: 'cover',
    }), {
      widthPx: 400,
      heightPx: 300,
    });

    const panned = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 100,
      fit: 'cover',
      imageOffsetXPercent: 50,
      imageOffsetYPercent: 50,
    }), {
      widthPx: 400,
      heightPx: 300,
    });

    expect(panned.targetWidthPx).toBeGreaterThan(centered.targetWidthPx);
    expect(panned.targetHeightPx).toBeGreaterThan(centered.targetHeightPx);
  });

  it('does not mark frames with comic sound effect decals for print-upscale jobs', () => {
    expect(isPaperPrintUpscaleSkippable({
      kind: 'image',
      comicSfxDesign: createPaperComicSfxDesign('bang'),
    })).toBe(true);

    expect(isPaperPrintUpscaleSkippable({
      kind: 'image',
    })).toBe(false);
  });

  it('includes user image scale and avoids replacing already sufficient assets', () => {
    expect(resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 50,
      heightMm: 50,
      fit: 'cover',
      imageScale: 1.5,
    }), {
      widthPx: 1200,
      heightPx: 1200,
    })).toMatchObject({
      targetWidthPx: 1200,
      targetHeightPx: 1200,
      needsUpscale: false,
      scaleFactor: 1,
    });
  });

  it('caps very large print targets to a browser-safe edge size', () => {
    expect(resolvePaperPrintUpscaleTarget(doc(600), frame({
      widthMm: 300,
      heightMm: 100,
      fit: 'cover',
    }), {
      widthPx: 1000,
      heightPx: 500,
      maxEdgePx: 2000,
    })).toMatchObject({
      targetWidthPx: 2000,
      targetHeightPx: 1000,
      capped: true,
    });
  });

  it('chooses the smallest Vertex Imagen upscale factor that satisfies the print target', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolveVertexImagenUpscaleFactor(target)).toBe('x2');
  });

  it('prefers square padded source dimensions for Vertex factor selection when image source is non-square', () => {
    expect(resolveVertexImagenUpscaleFactor({
      sourceWidthPx: 300,
      sourceHeightPx: 1000,
      targetWidthPx: 1300,
      targetHeightPx: 1300,
      needsUpscale: true,
    })).toBeUndefined();

    expect(resolveVertexImagenUpscaleFactor({
      sourceWidthPx: 300,
      sourceHeightPx: 1000,
      targetWidthPx: 1300,
      targetHeightPx: 1300,
      needsUpscale: true,
    }, { squarePadSource: true })).toBe('x2');
  });

  it('skips Vertex Imagen upscale when the smallest supported factor would exceed the model pixel cap', () => {
    expect(resolveVertexImagenUpscaleFactor({
      sourceWidthPx: 3000,
      sourceHeightPx: 3000,
      targetWidthPx: 4500,
      targetHeightPx: 4500,
      needsUpscale: true,
    })).toBeUndefined();
  });

  it('labels the cloud print upscale path for the busy indicator', () => {
    expect(describePaperPrintUpscaleBusyProvider('vertex-imagen', 'x2')).toBe('Cloud upscaler: Vertex Imagen x2');
    expect(describePaperPrintUpscaleBusyProvider('stability-fast')).toBe('Cloud upscaler: Stability Fast');
    expect(describePaperPrintUpscaleBusyProvider('stability-conservative')).toBe('Cloud upscaler: Stability Conservative');
    expect(describePaperPrintUpscaleBusyProvider('android-accelerator')).toBe('Android accelerator: NPU/GPU upscaler');
    expect(describePaperPrintUpscaleBusyProvider('browser')).toBe('Local print upscaler');
  });

  it('resolves the persisted print upscale method against available Vertex configuration', () => {
    expect(shouldUseVertexImagenPrintUpscale('auto', true)).toBe(true);
    expect(shouldUseVertexImagenPrintUpscale('auto', false)).toBe(false);
    expect(shouldUseVertexImagenPrintUpscale('local-browser', true)).toBe(false);
    expect(shouldUseVertexImagenPrintUpscale('vertex-imagen', true)).toBe(true);
    expect(shouldUseVertexImagenPrintUpscale('vertex-imagen', false)).toBe(false);
  });

  it('plans Auto print upscaling as cheap Stability Fast when a Stability key is available', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolvePaperPrintUpscalePlan({
      method: 'auto',
      target,
      stabilityAvailable: true,
      vertexAvailable: true,
    })).toMatchObject({
      provider: 'stability-fast',
      canRun: true,
      estimatedCostUsd: 0.02,
      usesLocalFinalFit: false,
    });
  });

  it('prefers the configured Android accelerator in Auto because it has no provider spend', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolvePaperPrintUpscalePlan({
      method: 'auto',
      target,
      stabilityAvailable: true,
      vertexAvailable: true,
      androidAcceleratorAvailable: true,
    })).toMatchObject({
      provider: 'android-accelerator',
      canRun: true,
      estimatedCostUsd: 0,
      usesLocalFinalFit: true,
    });
  });

  it('prefers Android native in-app image upscaling in Auto before local CPU or cloud providers', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolvePaperPrintUpscalePlan({
      method: 'auto',
      target,
      stabilityAvailable: true,
      vertexAvailable: true,
      localAiAvailable: true,
      androidNativeAvailable: true,
    })).toMatchObject({
      provider: 'android-native',
      canRun: true,
      estimatedCostUsd: 0,
      usesLocalFinalFit: true,
    });
    expect(describePaperPrintUpscaleBusyProvider('android-native')).toBe('Android native image upscaler');
  });

  it('falls back from Auto to Vertex when Stability is unavailable and Vertex can satisfy the target', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolvePaperPrintUpscalePlan({
      method: 'auto',
      target,
      stabilityAvailable: false,
      vertexAvailable: true,
      localAiAvailable: false,
    })).toMatchObject({
      provider: 'vertex-imagen',
      canRun: true,
      vertexUpscaleFactor: 'x2',
    });
  });

  it('uses square-padded Vertex for a non-square source in explicit Vertex plan fallback', () => {
    expect(resolvePaperPrintUpscalePlan({
      method: 'vertex-imagen',
      target: {
        sourceWidthPx: 300,
        sourceHeightPx: 1000,
        targetWidthPx: 1300,
        targetHeightPx: 1300,
        scaleFactor: 1,
        needsUpscale: true,
        capped: false,
      },
      stabilityAvailable: false,
      vertexAvailable: true,
    })).toMatchObject({
      provider: 'vertex-imagen',
      canRun: true,
      vertexUpscaleFactor: 'x2',
    });
  });

  it('prefers the configured local Vulkan upscaler in Auto when Android is not available', () => {
    const target = resolvePaperPrintUpscaleTarget(doc(300), frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
    }), {
      widthPx: 600,
      heightPx: 400,
    });

    expect(resolvePaperPrintUpscalePlan({
      method: 'auto',
      target,
      stabilityAvailable: true,
      vertexAvailable: true,
      localAiAvailable: true,
    })).toMatchObject({
      provider: 'local-ai-cpu',
      canRun: true,
      estimatedCostUsd: 0,
      usesLocalFinalFit: true,
      notes: [
        'Auto will use the configured local Vulkan AI upscaler because it has no cloud spend.',
        'Sloom Studio will still do an exact local fit to the document DPI after the AI pass.',
      ],
    });
  });

  it('marks direct cloud print-upscale methods unavailable instead of silently spending or falling back without credentials', () => {
    expect(resolvePaperPrintUpscalePlan({
      method: 'stability-conservative',
      target: {
        sourceWidthPx: 600,
        sourceHeightPx: 400,
        targetWidthPx: 1200,
        targetHeightPx: 800,
        scaleFactor: 2,
        needsUpscale: true,
        capped: false,
      },
      stabilityAvailable: false,
      vertexAvailable: false,
    })).toMatchObject({
      provider: 'stability-conservative',
      canRun: false,
      unavailableReason: 'Stability AI API key is not configured.',
      estimatedCostUsd: 0.4,
    });
  });

  it('estimates per-image and batch Stability print-upscale cost before execution', () => {
    expect(estimatePaperPrintUpscaleCostUsd('stability-fast', 1)).toBe(0.02);
    expect(estimatePaperPrintUpscaleCostUsd('stability-conservative', 24)).toBe(9.6);
    expect(estimatePaperPrintUpscaleCostUsd('android-accelerator', 24)).toBe(0);
    expect(estimatePaperPrintUpscaleCostUsd('local-ai-cpu', 24)).toBe(0);
    expect(estimatePaperPrintUpscaleCostUsd('local-browser', 24)).toBe(0);
  });

  it('builds project spend telemetry for print upscale operations', () => {
    expect(buildPaperPrintUpscaleUsageTelemetry({
      provider: 'stability-fast',
      estimatedCostUsd: 0.02,
      notes: ['exact local fit after AI upscale'],
    })).toEqual({
      source: 'actual',
      confidence: 'fixed',
      provider: 'stability',
      modelId: 'stable-image-upscale-fast',
      imageCount: 1,
      costUsd: 0.02,
      notes: ['exact local fit after AI upscale'],
    });

    expect(buildPaperPrintUpscaleUsageTelemetry({
      provider: 'local-ai-cpu',
      estimatedCostUsd: 0,
      notes: ['managed Vulkan runtime'],
    })).toEqual({
      source: 'actual',
      confidence: 'fixed',
      provider: 'local',
      modelId: 'realesrgan-ncnn-vulkan',
      imageCount: 1,
      costUsd: 0,
      notes: ['managed Vulkan runtime'],
    });
  });

  it('builds a frame patch that swaps in the upscaled image without changing the visible crop', () => {
    expect(buildPaperPrintUpscaledFramePatch(frame({
      asset: {
        sourceBinItemId: 'original-source',
        label: 'Original',
        kind: 'image',
        mimeType: 'image/png',
        pixelWidth: 600,
        pixelHeight: 400,
      },
      imageScale: 1.35,
      imageOffsetXPercent: -12,
      imageOffsetYPercent: 8,
      imageRotationDeg: 14,
      imageFlipX: true,
    }), {
      id: 'upscaled-source',
      label: 'Original print 1200x800',
      assetUrl: 'asset://upscaled',
      mimeType: 'image/png',
    }, {
      targetWidthPx: 1200,
      targetHeightPx: 800,
    })).toMatchObject({
      asset: {
        sourceBinItemId: 'upscaled-source',
        label: 'Original print 1200x800',
        kind: 'image',
        locator: { kind: 'external', url: 'asset://upscaled' },
        mimeType: 'image/png',
        pixelWidth: 1200,
        pixelHeight: 800,
      },
      fit: 'cover',
      imageScale: 1.35,
      imageOffsetXPercent: -12,
      imageOffsetYPercent: 8,
      imageRotationDeg: 14,
      imageFlipX: true,
    });
  });

  it('uses the managed Stability result dimensions without changing image placement metadata', () => {
    const sha256 = 'a'.repeat(64);
    const patch = buildPaperManagedPrintUpscaledFramePatch(frame({
      asset: {
        sourceBinItemId: 'original-source',
        label: 'Original',
        kind: 'image',
        pixelWidth: 600,
        pixelHeight: 400,
      },
      imageScale: 1.35,
      imageOffsetXPercent: -12,
      imageOffsetYPercent: 8,
      imageRotationDeg: 14,
      imageFlipX: true,
      imageFlipY: true,
    }), {
      asset: {
        id: `sha256:${sha256}`,
        sha256,
        mimeType: 'image/png',
        byteLength: 4,
      },
      providerWidthPx: 2449,
      providerHeightPx: 1633,
      mode: 'conservative',
      effectivePpi: 148,
      requiredPpi: 300,
      printReady: false,
    });

    expect(patch).toMatchObject({
      asset: {
        label: 'Original',
        kind: 'image',
        locator: {
          kind: 'managed',
          ref: expect.objectContaining({ id: `sha256:${sha256}` }),
        },
        pixelWidth: 2449,
        pixelHeight: 1633,
        printUpscale: {
          provider: 'stability',
          mode: 'conservative',
          providerWidthPx: 2449,
          providerHeightPx: 1633,
          effectivePpi: 148,
          requiredPpi: 300,
          printReady: false,
        },
      },
      fit: 'cover',
      imageScale: 1.35,
      imageOffsetXPercent: -12,
      imageOffsetYPercent: 8,
      imageRotationDeg: 14,
      imageFlipX: true,
      imageFlipY: true,
    });
    expect(patch.asset?.sourceBinItemId).toBeUndefined();
  });

  it('collects print upscale jobs while skipping frames that already use manual print-upscaled assets', () => {
    const document = doc();
    const pageId = document.pages[0].id;
    const originalFrame = frame({
      id: 'needs-upscale',
      asset: {
        sourceBinItemId: 'source-original',
        label: 'Original',
        kind: 'image',
        pixelWidth: 600,
        pixelHeight: 400,
      },
    });
    const manualFrame = frame({
      id: 'manual-upscale',
      asset: {
        sourceBinItemId: 'source-upscaled',
        label: 'Manual upscale',
        kind: 'image',
        pixelWidth: 1200,
        pixelHeight: 800,
      },
    });

    const jobs = collectPaperPrintUpscaleFrameJobs({
      ...document,
      pages: [{
        ...document.pages[0],
        id: pageId,
        frames: [originalFrame, manualFrame],
      }],
    }, [
      {
        id: 'source-original',
      },
      {
        id: 'source-upscaled',
        sourceKey: 'paper-print-upscale:source-original:300:1200x800:123',
        originNodeId: 'paper-print-upscale',
      },
    ]);

    expect(jobs).toEqual([{
      pageId,
      frameId: 'needs-upscale',
      frame: originalFrame,
    }]);
  });

  it('does not skip a prior print-upscaled asset when the current frame now needs more print pixels', () => {
    const document = doc(300);
    const pageId = document.pages[0].id;
    const stalePrintFrame = frame({
      id: 'stale-print-upscale',
      widthMm: 170,
      heightMm: 260,
      fit: 'cover',
      imageScale: 1,
      asset: {
        sourceBinItemId: 'source-upscaled-stale',
        label: 'Prior upscale',
        kind: 'image',
        pixelWidth: 1200,
        pixelHeight: 800,
      },
    });

    expect(isPaperFramePrintReady(document, stalePrintFrame)).toBe(false);
    expect(collectPaperPrintUpscaleFrameJobs({
      ...document,
      pages: [{
        ...document.pages[0],
        id: pageId,
        frames: [stalePrintFrame],
      }],
    }, [
      {
        id: 'source-upscaled-stale',
        sourceKey: 'paper-print-upscale:source-original:150:1200x800:123',
        originNodeId: 'paper-print-upscale',
        pixelWidth: 1200,
        pixelHeight: 800,
      },
    ])).toEqual([{
      pageId,
      frameId: 'stale-print-upscale',
      frame: stalePrintFrame,
    }]);
  });

  it('skips a prior print-upscaled asset only when it satisfies the current document DPI target', () => {
    const document = doc(300);
    const readyFrame = frame({
      id: 'ready-print-upscale',
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
      asset: {
        sourceBinItemId: 'source-upscaled-ready',
        label: 'Ready upscale',
        kind: 'image',
        pixelWidth: 1400,
        pixelHeight: 934,
      },
    });

    expect(isPaperFramePrintReady(document, readyFrame)).toBe(true);
    expect(collectPaperPrintUpscaleFrameJobs({
      ...document,
      pages: [{
        ...document.pages[0],
        frames: [readyFrame],
      }],
    }, [
      {
        id: 'source-upscaled-ready',
        sourceKey: 'paper-print-upscale:source-original:300:1400x934:123',
        originNodeId: 'paper-print-upscale',
        pixelWidth: 1400,
        pixelHeight: 934,
      },
    ])).toEqual([]);
  });

  it('keeps sub-300 PPI art in the print-finalization queue when the document preview DPI is lower', () => {
    const document = doc(144);
    const frameAtPreviewResolution = frame({
      widthMm: 100,
      heightMm: 50,
      fit: 'cover',
      asset: {
        sourceBinItemId: 'preview-resolution',
        label: 'Preview resolution',
        kind: 'image',
        pixelWidth: 1000,
        pixelHeight: 500,
      },
    });

    expect(isPaperFramePrintReady(document, frameAtPreviewResolution)).toBe(false);
  });

  it('formats Paper batch progress with provider, target pixels, and document DPI', () => {
    expect(formatPaperPrintUpscaleProgress({
      current: 2,
      total: 9,
      label: 'panel-02.png',
      provider: 'android-accelerator',
      targetWidthPx: 2447,
      targetHeightPx: 1366,
      dpi: 300,
    })).toBe('2/9 panel-02.png: Android accelerator: NPU/GPU upscaler -> 2447 x 1366px @ 300 DPI');
  });
});
