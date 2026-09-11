import { describe, expect, it } from 'vitest';
import {
  describeMagicWandReadiness,
  describePaintBucketActionReadiness,
  describePaintBucketFillOperation,
  fillContiguousColorRegion,
} from './ImagePaintBucket';

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = rgba[0];
  imageData.data[offset + 1] = rgba[1];
  imageData.data[offset + 2] = rgba[2];
  imageData.data[offset + 3] = rgba[3];
}

function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

describe('ImagePaintBucket', () => {
  it('fills a contiguous same-color region from the clicked seed', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [255, 0, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 255, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#00ff00',
      opacity: 1,
      tolerance: 0,
    });

    expect(getPixel(filled, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(filled, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(filled, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('applies a fractional one-pixel edge when Paint Bucket anti-alias is enabled', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [255, 0, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 255, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#00ff00',
      opacity: 1,
      tolerance: 0,
      antiAlias: true,
    });

    expect(getPixel(filled, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(filled, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(filled, 2, 0)).toEqual([0, 48, 207, 255]);
  });

  it('blends the fill color by opacity', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#000000',
      opacity: 0.5,
      tolerance: 0,
    });

    expect(getPixel(filled, 0, 0)).toEqual([50, 75, 100, 255]);
  });

  it('applies supported fill blend modes before opacity compositing', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#808080',
      opacity: 1,
      tolerance: 0,
      blendMode: 'multiply',
    });

    expect(getPixel(filled, 0, 0)).toEqual([50, 75, 100, 255]);
  });

  it('preserves existing transparent pixels when preserve transparency is enabled', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [40, 50, 60, 0]);
    setPixel(imageData, 1, 0, [40, 50, 60, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#ff0000',
      opacity: 1,
      tolerance: 0,
      contiguous: false,
      preserveTransparency: true,
    });

    expect(getPixel(filled, 0, 0)).toEqual([40, 50, 60, 0]);
    expect(getPixel(filled, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('fills non-contiguous matching colors when contiguous matching is disabled', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 0, 255, 255]);
    setPixel(imageData, 2, 0, [255, 0, 0, 255]);

    const filled = fillContiguousColorRegion(imageData, {
      seed: { x: 0, y: 0 },
      color: '#00ff00',
      opacity: 1,
      tolerance: 0,
      contiguous: false,
    });

    expect(getPixel(filled, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(filled, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(filled, 2, 0)).toEqual([0, 255, 0, 255]);
  });

  it('describes deterministic fill matching, sampling, target channel, and unsupported edge controls', () => {
    const descriptor = describePaintBucketFillOperation({
      seed: { x: 4.8, y: 2.2 },
      color: '#12ABef',
      opacity: 0.625,
      tolerance: 300,
      contiguous: false,
      sampleAllLayers: true,
      targetChannel: 'blue',
      requestedAntiAlias: true,
      requestedGapClose: 2,
      blendMode: 'screen',
      preserveTransparency: true,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'paint-bucket-fill-operation:v1',
      seed: { x: 4, y: 2 },
      tolerance: {
        value: 255,
        metric: 'rgb-euclidean-distance',
      },
      matching: {
        scope: 'global',
        connectivity: 'document-wide',
        gapClosePixels: 2,
        gapCloseSupported: false,
      },
      sampling: {
        sampleAllLayers: true,
        source: 'visible-document-composite',
      },
      fill: {
        color: '#12abef',
        opacity: 0.625,
        blendMode: 'screen',
        preserveTransparency: true,
        output: 'active-layer-rgba',
      },
      target: {
        requestedChannel: 'blue',
        writtenComponents: ['red', 'green', 'blue', 'alpha'],
        channelRouting: 'composite-rgba-channel-request-unsupported',
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'gap-close-unsupported',
      'channel-specific-fill-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe(
      'paint-bucket-fill-operation:v1:{"seed":{"x":4,"y":2},"tolerance":255,"matching":{"scope":"global","connectivity":"document-wide","gapClosePixels":2},"sampling":"visible-document-composite","fill":{"color":"#12abef","opacity":0.625,"blendMode":"screen","preserveTransparency":true,"output":"active-layer-rgba"},"target":{"requestedChannel":"blue","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"]}',
    );
  });

  it('summarizes magic wand readiness with stable sampling, caveat, blocker, and preview metadata', () => {
    const readiness = describeMagicWandReadiness({
      seed: { x: 9.7, y: -1.2 },
      tolerance: 18.257,
      contiguous: false,
      sampleAllLayers: true,
      targetChannel: 'alpha',
      requestedAntiAlias: true,
      requestedGapClose: true,
      hasPixelSource: false,
    });

    expect(readiness).toMatchObject({
      descriptorId: 'magic-wand-readiness:v1',
      tool: 'magic-wand',
      seed: { x: 9, y: -2 },
      tolerance: {
        value: 18.257,
        metric: 'rgb-euclidean-distance',
      },
      selection: {
        output: 'selection-mask',
        scope: 'global',
        connectivity: 'document-wide',
      },
      sampling: {
        sampleAllLayers: true,
        source: 'visible-document-composite',
      },
      target: {
        requestedChannel: 'alpha',
        channelSensitivity: 'composite-rgba-channel-request-unsupported',
      },
      readiness: {
        status: 'blocked',
        blockerCodes: ['missing-pixel-source'],
      },
    });
    expect(readiness.caveats.map((caveat) => caveat.code)).toEqual([
      'anti-alias-selection-edge-unsupported',
      'gap-close-unsupported',
      'channel-specific-selection-unsupported',
    ]);
    expect(readiness.previewSignature).toBe(
      'magic-wand-readiness:v1:{"seed":{"x":9,"y":-2},"tolerance":18.257,"selection":{"scope":"global","connectivity":"document-wide"},"sampling":"visible-document-composite","target":{"requestedChannel":"alpha","channelSensitivity":"composite-rgba-channel-request-unsupported"},"caveats":["anti-alias-selection-edge-unsupported","gap-close-unsupported","channel-specific-selection-unsupported"],"blockers":["missing-pixel-source"]}',
    );
  });

  it('reports paint bucket readiness blockers separately from unsupported edge caveats', () => {
    const readiness = describePaintBucketFillOperation({
      seed: { x: 0, y: 0 },
      color: 'bad-color',
      opacity: 0.5,
      tolerance: -5,
      hasWritableLayer: false,
      hasPixelSource: true,
      targetChannel: 'rgb',
    });

    expect(readiness.tolerance.value).toBe(0);
    expect(readiness.fill.color).toBe('#000000');
    expect(readiness.readiness).toEqual({
      status: 'blocked',
      blockerCodes: ['missing-writable-layer'],
    });
    expect(readiness.warnings).toEqual([]);
    expect(readiness.previewSignature).toContain('"blockers":["missing-writable-layer"]');
  });

  it('describes paint bucket action readiness with alpha, mask, channel, and batch caveats', () => {
    const readiness = describePaintBucketActionReadiness({
      seed: { x: 3.2, y: 5.8 },
      color: '#ff00aa',
      opacity: 0,
      tolerance: Number.NaN,
      contiguous: false,
      sampleAllLayers: true,
      preserveTransparency: true,
      target: 'layer-mask',
      targetChannel: 'spot',
      requestedAntiAlias: true,
      requestedGapClose: 4,
      requestedPatternFill: true,
      requestedContentAwareFill: true,
      hasPixelSource: false,
      hasWritableLayer: false,
      batch: true,
      actionRecording: true,
    });

    expect(readiness.descriptorId).toBe('paint-bucket-action-readiness:v1');
    expect(readiness.tolerance).toEqual({
      value: 0,
      valid: false,
      metric: 'rgb-euclidean-distance',
      caveat: 'Invalid tolerance values are clamped for descriptors and block execution until corrected.',
    });
    expect(readiness.matching).toEqual({
      scope: 'global',
      contiguous: false,
      connectivity: 'document-wide',
      caveat: 'Global matching fills every document pixel whose sampled RGB color is within tolerance of the seed color.',
    });
    expect(readiness.alpha).toEqual({
      opacity: 0,
      preservesTransparency: true,
      writesTransparentPixels: false,
      transparentFill: true,
      caveat: 'Opacity 0 produces a transparent no-op style fill descriptor; preserve transparency prevents alpha expansion on fully transparent pixels.',
    });
    expect(readiness.target).toEqual({
      requested: 'layer-mask',
      requestedChannel: 'spot',
      writePath: 'active-layer-mask-alpha',
      channelRouting: 'composite-rgba-channel-request-unsupported',
      caveats: [
        'Layer mask Paint Bucket routing is descriptor-only here; runtime bucket fills still target active layer RGBA pixels.',
        'Spot channel routing is unsupported for Paint Bucket fills; use composite RGBA or a dedicated channel workflow.',
      ],
    });
    expect(readiness.blockers).toEqual([
      { code: 'missing-pixel-source', severity: 'blocker', message: 'Paint Bucket matching requires an active layer bitmap or visible composite sample source.' },
      { code: 'missing-writable-layer', severity: 'blocker', message: 'Paint Bucket fill requires a writable active layer target.' },
      { code: 'invalid-tolerance', severity: 'blocker', message: 'Paint Bucket tolerance must be a finite number between 0 and 255.' },
      { code: 'zero-opacity-fill', severity: 'blocker', message: 'Paint Bucket opacity must be greater than 0 to change pixels.' },
    ]);
    expect(readiness.unsupported.map((entry) => entry.feature)).toEqual([
      'gap-close',
      'pattern-fill',
      'content-aware-fill',
      'channel-specific-fill',
    ]);
    expect(readiness.batch).toEqual({
      suitable: false,
      actionRecordable: true,
      exportSignature: 'paint-bucket-action-batch:v1|paint-bucket-fill-operation:v1:{"seed":{"x":3,"y":5},"tolerance":0,"matching":{"scope":"global","connectivity":"document-wide","gapClosePixels":4},"sampling":"visible-document-composite","fill":{"color":"#ff00aa","opacity":0,"blendMode":"normal","preserveTransparency":true,"output":"active-layer-rgba"},"target":{"requestedChannel":"spot","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"],"blockers":["missing-pixel-source","missing-writable-layer"]}|target:layer-mask|route:active-layer-mask-alpha',
      caveats: [
        'Batch Paint Bucket actions require a valid seed, finite tolerance, pixel source, and writable layer for every document.',
        'Recorded actions can replay seed, tolerance, contiguous/global matching, sample-all-layers, opacity, blend mode, transparency preservation, and target metadata.',
      ],
    });
    expect(readiness.preview.signature).toBe(
      'paint-bucket-action-readiness:v1|paint-bucket-fill-operation:v1:{"seed":{"x":3,"y":5},"tolerance":0,"matching":{"scope":"global","connectivity":"document-wide","gapClosePixels":4},"sampling":"visible-document-composite","fill":{"color":"#ff00aa","opacity":0,"blendMode":"normal","preserveTransparency":true,"output":"active-layer-rgba"},"target":{"requestedChannel":"spot","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"],"blockers":["missing-pixel-source","missing-writable-layer"]}|target:layer-mask|blockers:missing-pixel-source,missing-writable-layer,invalid-tolerance,zero-opacity-fill|batch:false',
    );
  });

  it('describes anti-alias and gap-close limits alongside mask/channel routing caveats', () => {
    const readiness = describePaintBucketActionReadiness({
      seed: { x: 6, y: 4 },
      color: '#00ff88',
      opacity: 0.8,
      tolerance: 12,
      contiguous: true,
      sampleAllLayers: false,
      target: 'quick-mask',
      targetChannel: 'alpha',
      requestedAntiAlias: true,
      requestedGapClose: 3,
      hasPixelSource: true,
      hasWritableLayer: true,
      batch: true,
      actionRecording: false,
    });

    expect(readiness.edgeControls).toEqual({
      antiAlias: {
        requested: true,
        supported: true,
        maxPixels: 1,
        caveat: 'Paint Bucket applies a one-pixel neighbor-coverage fringe to soften the fill edge.',
      },
      gapClose: {
        requestedPixels: 3,
        supported: false,
        maxPixels: 0,
        caveat: 'Gap close is unavailable for Paint Bucket fills; non-zero requests stay descriptor-only and do not bridge narrow openings.',
      },
    });
    expect(readiness.target).toEqual({
      requested: 'quick-mask',
      requestedChannel: 'alpha',
      writePath: 'quick-mask-alpha',
      channelRouting: 'composite-rgba-channel-request-unsupported',
      caveats: [
        'Quick Mask Paint Bucket routing is descriptor-only here; commit requires a selection/mask workflow.',
        'Alpha channel routing is unsupported for Paint Bucket fills; use layer mask or saved-channel workflows.',
      ],
    });
    expect(readiness.batch).toEqual({
      suitable: true,
      actionRecordable: false,
      exportSignature: 'paint-bucket-action-batch:v1|paint-bucket-fill-operation:v1:{"seed":{"x":6,"y":4},"tolerance":12,"matching":{"scope":"contiguous","connectivity":4,"gapClosePixels":3},"sampling":"active-layer-bitmap","fill":{"color":"#00ff88","opacity":0.8,"blendMode":"normal","preserveTransparency":false,"output":"active-layer-rgba"},"target":{"requestedChannel":"alpha","channelRouting":"composite-rgba-channel-request-unsupported"},"warnings":["gap-close-unsupported","channel-specific-fill-unsupported"]}|target:quick-mask|route:quick-mask-alpha',
      caveats: [
        'Batch Paint Bucket actions require a valid seed, finite tolerance, pixel source, and writable layer for every document.',
        'Recorded actions can replay seed, tolerance, contiguous/global matching, sample-all-layers, opacity, blend mode, transparency preservation, and target metadata.',
      ],
    });
  });

  it('adds typed readiness checks, routing blockers, and stable signatures for bucket edge parity', () => {
    const readiness = describePaintBucketActionReadiness({
      seed: { x: 2, y: 1 },
      color: '#224466',
      opacity: 0.75,
      tolerance: 22,
      contiguous: true,
      sampleAllLayers: true,
      blendMode: 'hard-light',
      preserveTransparency: true,
      target: 'layer-mask',
      targetChannel: 'red',
      requestedAntiAlias: true,
      requestedGapClose: 2,
      hasPixelSource: true,
      hasWritableLayer: true,
      batch: true,
      actionRecording: true,
    });

    expect(readiness.checks.map((check) => ({
      code: check.code,
      status: check.status,
      caveatCodes: check.caveatCodes,
      blockerCodes: check.blockerCodes,
    }))).toEqual([
      { code: 'tolerance', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'sample-all-layers', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'contiguous', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'anti-alias', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'gap-close', status: 'unsupported', caveatCodes: ['gap-close-unsupported'], blockerCodes: [] },
      { code: 'blend-mode', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'preserve-transparency', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'target-routing', status: 'blocked', caveatCodes: [], blockerCodes: ['layer-mask-runtime-route-unsupported'] },
      { code: 'channel-routing', status: 'blocked', caveatCodes: ['channel-specific-fill-unsupported'], blockerCodes: ['channel-specific-runtime-route-unsupported'] },
    ]);
    expect(readiness.routing).toEqual({
      fill: {
        route: 'active-layer-rgba-compositor',
        blendMode: 'hard-light',
        preserveTransparency: true,
        opacity: 0.75,
        signature: 'paint-bucket-fill-routing:v1:{"route":"active-layer-rgba-compositor","blendMode":"hard-light","preserveTransparency":true,"opacity":0.75}',
      },
      target: {
        requested: 'layer-mask',
        requestedChannel: 'red',
        writePath: 'active-layer-mask-alpha',
        runtimeStatus: 'blocked',
        blockers: [
          {
            code: 'layer-mask-runtime-route-unsupported',
            severity: 'blocker',
            target: 'layer-mask',
            message: 'Layer mask Paint Bucket fills are descriptor-only; runtime fills still write active layer RGBA pixels.',
          },
          {
            code: 'channel-specific-runtime-route-unsupported',
            severity: 'blocker',
            target: 'layer-mask',
            message: 'Paint Bucket channel-specific routing is descriptor-only; runtime fills still write composite RGBA pixels.',
          },
        ],
        signature: 'paint-bucket-target-routing:v1:{"requested":"layer-mask","requestedChannel":"red","writePath":"active-layer-mask-alpha","blockers":["layer-mask-runtime-route-unsupported","channel-specific-runtime-route-unsupported"]}',
      },
    });
    expect(readiness.stableSignatures).toEqual({
      operation: readiness.operation.previewSignature,
      checks: 'image-paint-readiness-checks:v1:["tolerance:ready","sample-all-layers:ready","contiguous:ready","anti-alias:ready","gap-close:unsupported","blend-mode:ready","preserve-transparency:ready","target-routing:blocked","channel-routing:blocked"]',
      routing: 'paint-bucket-routing:v1:{"fill":{"route":"active-layer-rgba-compositor","blendMode":"hard-light","preserveTransparency":true,"opacity":0.75},"target":{"requested":"layer-mask","requestedChannel":"red","writePath":"active-layer-mask-alpha","blockers":["layer-mask-runtime-route-unsupported","channel-specific-runtime-route-unsupported"]}}',
      preview: readiness.preview.signature,
    });
  });
});
