import { describe, expect, it } from 'vitest';
import {
  buildImageHistogram,
  buildImageHistogramPanelDescriptor,
  buildImageHistogramChannelReadoutDescriptor,
  buildImageHistogramSignature,
  describeImageHistogramChannelCoverage,
  describeImageHistogramBeforeAfterSignatures,
  buildImageHistogramPreviewSourceDescriptor,
  compareHistogramChannelStats,
  formatHistogramChannelSummary,
  getHistogramChannelStats,
  summarizeHistogramBins,
} from './ImageHistogram';

function makeImageData(width: number, height: number, data: number[]): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(data),
  } as ImageData;
}

describe('ImageHistogram', () => {
  it('builds tonal and alpha histograms without letting transparent pixels skew luminance', () => {
    const imageData = makeImageData(4, 1, [
      0, 0, 0, 255,
      128, 0, 0, 128,
      255, 255, 255, 0,
      255, 255, 255, 255,
    ]);

    const histogram = buildImageHistogram(imageData);

    expect(histogram.totalPixels).toBe(4);
    expect(histogram.visiblePixels).toBe(3);
    expect(histogram.transparentPixels).toBe(1);
    expect(histogram.channels.alpha[0]).toBe(1);
    expect(histogram.channels.alpha[128]).toBe(1);
    expect(histogram.channels.alpha[255]).toBe(2);
    expect(histogram.channels.red[0]).toBe(1);
    expect(histogram.channels.red[128]).toBe(1);
    expect(histogram.channels.red[255]).toBe(1);
    expect(histogram.channels.luminance[0]).toBe(1);
    expect(histogram.channels.luminance[27]).toBe(1);
    expect(histogram.channels.luminance[255]).toBe(1);
    expect(histogram.minLuminance).toBe(0);
    expect(histogram.maxLuminance).toBe(255);
    expect(histogram.meanLuminance).toBe(94);
  });

  it('summarizes 256-bin channels into stable display buckets', () => {
    const channel = new Uint32Array(256);
    channel[0] = 1;
    channel[63] = 2;
    channel[64] = 3;
    channel[255] = 4;

    expect(summarizeHistogramBins(channel, 4)).toEqual([3, 3, 0, 4]);
  });

  it('reports per-channel range, mean, and clipping counts for visible tone and full alpha data', () => {
    const imageData = makeImageData(4, 1, [
      0, 0, 0, 255,
      128, 0, 0, 128,
      255, 255, 255, 0,
      255, 255, 255, 255,
    ]);

    const histogram = buildImageHistogram(imageData);

    expect(getHistogramChannelStats(histogram, 'red')).toEqual({
      min: 0,
      max: 255,
      mean: 128,
      clippedShadows: 1,
      clippedHighlights: 1,
      sampleCount: 3,
    });
    expect(getHistogramChannelStats(histogram, 'alpha')).toEqual({
      min: 0,
      max: 255,
      mean: 160,
      clippedShadows: 1,
      clippedHighlights: 2,
      sampleCount: 4,
    });
  });

  it('compares per-channel histogram stats into deterministic tonal and clipping deltas', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      128, 0, 0, 255,
      255, 0, 0, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      64, 0, 0, 255,
      192, 0, 0, 255,
      255, 0, 0, 255,
    ]));

    expect(compareHistogramChannelStats(before, after, 'red')).toEqual({
      channel: 'red',
      before: {
        min: 0,
        max: 255,
        mean: 96,
        clippedShadows: 2,
        clippedHighlights: 1,
        sampleCount: 4,
      },
      after: {
        min: 0,
        max: 255,
        mean: 128,
        clippedShadows: 1,
        clippedHighlights: 1,
        sampleCount: 4,
      },
      minDelta: 0,
      maxDelta: 0,
      meanDelta: 32,
      sampleCountDelta: 0,
      clippedShadowsDelta: -1,
      clippedHighlightsDelta: 0,
      tonalShift: 'brighter',
      contrastShift: 'stable',
      clippingShift: 'shadow-recovery',
    });
  });

  it('formats histogram stats into short deterministic summary labels', () => {
    const histogram = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      128, 0, 0, 255,
      255, 0, 0, 255,
    ]));

    expect(formatHistogramChannelSummary(histogram, 'red')).toBe(
      'Red 0-255 mean 96, clip 2/1',
    );
    expect(formatHistogramChannelSummary(histogram, 'alpha')).toBe(
      'Alpha 255-255 mean 255, clip 0/4',
    );
  });

  it('builds deterministic panel readout descriptors for luminance and RGB channels', () => {
    const histogram = buildImageHistogram(makeImageData(5, 1, [
      0, 0, 0, 255,
      32, 64, 96, 255,
      128, 128, 128, 255,
      255, 10, 10, 255,
      255, 255, 255, 0,
    ]));

    expect(buildImageHistogramPanelDescriptor({
      histogram,
      sourceSignature: 'doc:visible:v8',
      sourceLabel: 'Visible composite',
    })).toEqual({
      version: 1,
      panel: 'image-histogram',
      previewKind: 'static',
      livePreview: false,
      sourceLabel: 'Visible composite',
      sourceSignature: 'doc:visible:v8',
      histogramSignature: 'histogram-panel:v1:{"sourceSignature":"doc:visible:v8","previewKind":"static","visiblePixels":4,"transparentPixels":1,"totalPixels":5,"channelMeans":{"luminance":63,"red":104,"green":51,"blue":59},"channelRanges":{"luminance":[0,128],"red":[0,255],"green":[0,128],"blue":[0,128]},"channelClipping":{"luminance":[1,0],"red":[1,1],"green":[1,0],"blue":[1,0]}}',
      totalPixels: 5,
      visiblePixels: 4,
      transparentPixels: 1,
      channelOrder: ['luminance', 'red', 'green', 'blue'],
      channelSummaries: {
        luminance: {
          channel: 'luminance',
          label: 'Luminance',
          rangeLabel: '0-128',
          meanLabel: '63',
          clippingLabel: '1 shadow / 0 highlights',
          sampleCount: 4,
          min: 0,
          max: 128,
          mean: 63,
          clippedShadows: 1,
          clippedHighlights: 0,
          clippedTotal: 1,
          hasSamples: true,
          isClipped: true,
        },
        red: {
          channel: 'red',
          label: 'Red',
          rangeLabel: '0-255',
          meanLabel: '104',
          clippingLabel: '1 shadow / 1 highlight',
          sampleCount: 4,
          min: 0,
          max: 255,
          mean: 104,
          clippedShadows: 1,
          clippedHighlights: 1,
          clippedTotal: 2,
          hasSamples: true,
          isClipped: true,
        },
        green: {
          channel: 'green',
          label: 'Green',
          rangeLabel: '0-128',
          meanLabel: '51',
          clippingLabel: '1 shadow / 0 highlights',
          sampleCount: 4,
          min: 0,
          max: 128,
          mean: 51,
          clippedShadows: 1,
          clippedHighlights: 0,
          clippedTotal: 1,
          hasSamples: true,
          isClipped: true,
        },
        blue: {
          channel: 'blue',
          label: 'Blue',
          rangeLabel: '0-128',
          meanLabel: '59',
          clippingLabel: '1 shadow / 0 highlights',
          sampleCount: 4,
          min: 0,
          max: 128,
          mean: 59,
          clippedShadows: 1,
          clippedHighlights: 0,
          clippedTotal: 1,
          hasSamples: true,
          isClipped: true,
        },
      },
      clipping: {
        clippedShadows: 4,
        clippedHighlights: 1,
        clippedTotal: 5,
        clippedChannels: ['luminance', 'red', 'green', 'blue'],
      },
      caveats: [],
    });
  });

  it('adds before-after comparison metadata and adjustment-preview signature fields', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      32, 0, 0, 255,
      128, 0, 0, 255,
      255, 0, 0, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      16, 0, 0, 255,
      64, 0, 0, 255,
      192, 0, 0, 255,
      255, 0, 0, 255,
    ]));

    const descriptor = buildImageHistogramPanelDescriptor({
      histogram: after,
      sourceSignature: 'doc:visible:v9',
      sourceLabel: 'Levels preview composite',
      preview: {
        kind: 'adjustment-preview',
        beforeHistogram: before,
        beforeSignature: 'histogram:before:v8',
        adjustmentLayerId: 'levels-1',
        adjustmentKind: 'levels',
        adjustmentChannel: 'rgb',
        signatureFields: {
          documentSignature: 'doc:2x1:v8',
          baseLayerIds: ['background', 'paint'],
        },
      },
    });

    expect(descriptor.previewKind).toBe('adjustment-preview');
    expect(descriptor.preview).toEqual({
      kind: 'adjustment-preview',
      adjustmentLayerId: 'levels-1',
      adjustmentKind: 'levels',
      adjustmentChannel: 'rgb',
      beforeSignature: 'histogram:before:v8',
      afterSignature: descriptor.histogramSignature,
      sourceSignature: 'histogram-preview:v1:{"kind":"adjustment-preview","sourceSignature":"doc:visible:v9","adjustmentLayerId":"levels-1","adjustmentKind":"levels","adjustmentChannel":"rgb","signatureFields":{"baseLayerIds":["background","paint"],"documentSignature":"doc:2x1:v8"}}',
      signatureFields: {
        adjustmentChannel: 'rgb',
        adjustmentKind: 'levels',
        adjustmentLayerId: 'levels-1',
        baseLayerIds: ['background', 'paint'],
        documentSignature: 'doc:2x1:v8',
      },
      caveats: [
        'Adjustment preview histograms are advisory and use rendered 8-bit RGB canvas pixels.',
      ],
    });
    expect(descriptor.comparison?.channels.red.tonalShift).toBe('brighter');
    expect(descriptor.comparison?.channels.red.clippingShift).toBe('shadow-recovery');
    expect(descriptor.comparison?.changedChannels).toEqual(['luminance', 'red']);
    expect(descriptor.comparison?.meanDeltaRange).toEqual({ min: 6, max: 28 });
    expect(descriptor.caveats).toEqual([
      'Adjustment preview histograms are advisory and use rendered 8-bit RGB canvas pixels.',
    ]);
  });

  it('describes live-preview histogram source signatures with an explicit caveat', () => {
    expect(buildImageHistogramPreviewSourceDescriptor({
      kind: 'live-preview',
      sourceSignature: 'doc:visible:v10',
      adjustmentLayerId: 'curves-1',
      adjustmentKind: 'curves',
      adjustmentChannel: 'blue',
      signatureFields: {
        documentSignature: 'doc:2x1:v10',
        previewNonce: 4,
      },
    })).toEqual({
      kind: 'live-preview',
      sourceSignature: 'histogram-preview:v1:{"kind":"live-preview","sourceSignature":"doc:visible:v10","adjustmentLayerId":"curves-1","adjustmentKind":"curves","adjustmentChannel":"blue","signatureFields":{"documentSignature":"doc:2x1:v10","previewNonce":4}}',
      signatureFields: {
        adjustmentChannel: 'blue',
        adjustmentKind: 'curves',
        adjustmentLayerId: 'curves-1',
        documentSignature: 'doc:2x1:v10',
        previewNonce: 4,
      },
      caveats: [
        'Live preview histograms may lag pointer updates and should not be treated as committed document state.',
      ],
    });
  });

  it('builds explicit channel readout descriptors for supported and unsupported histogram channels', () => {
    const histogram = buildImageHistogram(makeImageData(3, 1, [
      0, 0, 0, 255,
      128, 128, 128, 128,
      255, 255, 255, 255,
    ]));

    const luminance = buildImageHistogramChannelReadoutDescriptor({
      histogram,
      channel: 'luminance',
    });
    const alpha = buildImageHistogramChannelReadoutDescriptor({
      histogram,
      channel: 'alpha',
    });

    expect(luminance).toMatchObject({
      channel: 'luminance',
      label: 'Luminance',
      isToneChannel: true,
      isSupported: true,
      rangeLabel: '0-255',
      meanLabel: '128',
      clippingLabel: '1 shadow / 1 highlight',
      clippedTotal: 2,
      hasSamples: true,
      isClipped: true,
      caveats: [],
    });

    expect(alpha).toMatchObject({
      channel: 'alpha',
      label: 'Alpha',
      isToneChannel: false,
      isSupported: false,
      rangeLabel: '128-255',
      meanLabel: '213',
      clippingLabel: '0 shadows / 2 highlights',
      clippedTotal: 2,
      hasSamples: true,
      isClipped: true,
      caveats: ['Alpha histogram is informational only; tone clipping and tone-adjustment channels are not derived from alpha.'],
    });
  });

  it('describes channel coverage and clip warnings for histogram readiness displays', () => {
    const histogram = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      255, 32, 32, 255,
      64, 128, 192, 128,
      255, 255, 255, 0,
    ]));

    expect(describeImageHistogramChannelCoverage(histogram, {
      requestedChannels: ['luminance', 'red', 'alpha'],
      clipWarningThreshold: 2,
    })).toEqual({
      version: 1,
      totalPixels: 4,
      visiblePixels: 3,
      transparentPixels: 1,
      requestedChannels: ['luminance', 'red', 'alpha'],
      supportedToneChannels: ['luminance', 'red'],
      informationalChannels: ['alpha'],
      missingChannels: [],
      coverage: {
        luminance: {
          channel: 'luminance',
          label: 'Luminance',
          sampleCount: 3,
          coverageRatio: 1,
          hasSamples: true,
          toneAdjustable: true,
          clippedShadows: 1,
          clippedHighlights: 0,
          clippedTotal: 1,
          warning: null,
        },
        red: {
          channel: 'red',
          label: 'Red',
          sampleCount: 3,
          coverageRatio: 1,
          hasSamples: true,
          toneAdjustable: true,
          clippedShadows: 1,
          clippedHighlights: 1,
          clippedTotal: 2,
          warning: {
            code: 'histogram-channel-clipped',
            severity: 'warning',
            channel: 'red',
            clippedShadows: 1,
            clippedHighlights: 1,
            message: 'Red has 2 clipped pixels; preview/apply should preserve a visible clipping warning.',
          },
        },
        alpha: {
          channel: 'alpha',
          label: 'Alpha',
          sampleCount: 4,
          coverageRatio: 1,
          hasSamples: true,
          toneAdjustable: false,
          clippedShadows: 1,
          clippedHighlights: 2,
          clippedTotal: 3,
          warning: {
            code: 'histogram-alpha-informational',
            severity: 'info',
            channel: 'alpha',
            clippedShadows: 1,
            clippedHighlights: 2,
            message: 'Alpha is shown for coverage only; tone adjustments do not use alpha histogram bins.',
          },
        },
      },
      warnings: [
        {
          code: 'histogram-channel-clipped',
          severity: 'warning',
          channel: 'red',
          clippedShadows: 1,
          clippedHighlights: 1,
          message: 'Red has 2 clipped pixels; preview/apply should preserve a visible clipping warning.',
        },
        {
          code: 'histogram-alpha-informational',
          severity: 'info',
          channel: 'alpha',
          clippedShadows: 1,
          clippedHighlights: 2,
          message: 'Alpha is shown for coverage only; tone adjustments do not use alpha histogram bins.',
        },
      ],
      signature: 'histogram-channel-coverage:v1:{"requestedChannels":["luminance","red","alpha"],"visiblePixels":3,"transparentPixels":1,"clipWarningThreshold":2,"coverage":{"luminance":{"sampleCount":3,"clippedShadows":1,"clippedHighlights":0},"red":{"sampleCount":3,"clippedShadows":1,"clippedHighlights":1},"alpha":{"sampleCount":4,"clippedShadows":1,"clippedHighlights":2}}}',
    });
  });

  it('builds stable before/after histogram signatures and channel clipping deltas', () => {
    const before = buildImageHistogram(makeImageData(4, 1, [
      0, 0, 0, 255,
      64, 64, 64, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]));
    const after = buildImageHistogram(makeImageData(4, 1, [
      16, 16, 16, 255,
      64, 64, 64, 255,
      240, 240, 240, 255,
      255, 255, 255, 255,
    ]));

    const beforeSignature = buildImageHistogramSignature(before, {
      role: 'before-adjustment',
      sourceSignature: 'doc:hist:v1',
      channels: ['luminance', 'red'],
    });
    const descriptor = describeImageHistogramBeforeAfterSignatures({
      beforeHistogram: before,
      afterHistogram: after,
      sourceSignature: 'doc:hist:v1',
      channels: ['luminance', 'red'],
    });

    expect(beforeSignature).toBe(
      'histogram-signature:v1:{"role":"before-adjustment","sourceSignature":"doc:hist:v1","totalPixels":4,"visiblePixels":4,"transparentPixels":0,"channels":{"luminance":{"min":0,"max":255,"mean":144,"clippedShadows":1,"clippedHighlights":2,"sampleCount":4},"red":{"min":0,"max":255,"mean":144,"clippedShadows":1,"clippedHighlights":2,"sampleCount":4}}}',
    );
    expect(descriptor.beforeSignature).toBe(beforeSignature);
    expect(descriptor.channelClippingDeltas).toEqual([
      {
        channel: 'luminance',
        beforeClippedShadows: 1,
        afterClippedShadows: 0,
        clippedShadowsDelta: -1,
        beforeClippedHighlights: 2,
        afterClippedHighlights: 1,
        clippedHighlightsDelta: -1,
        clippedTotalDelta: -2,
        clippingShift: 'reduced',
      },
      {
        channel: 'red',
        beforeClippedShadows: 1,
        afterClippedShadows: 0,
        clippedShadowsDelta: -1,
        beforeClippedHighlights: 2,
        afterClippedHighlights: 1,
        clippedHighlightsDelta: -1,
        clippedTotalDelta: -2,
        clippingShift: 'reduced',
      },
    ]);
    expect(descriptor.changedClippingChannels).toEqual(['luminance', 'red']);
    expect(descriptor.stableSignature).toBe(describeImageHistogramBeforeAfterSignatures({
      beforeHistogram: before,
      afterHistogram: after,
      sourceSignature: 'doc:hist:v1',
      channels: ['luminance', 'red'],
    }).stableSignature);
    expect(descriptor.stableSignature).toContain('"clippedTotalDelta":-2');
  });
});
