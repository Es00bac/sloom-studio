import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyGradientToImageData,
  describeGradientActionReadiness,
  describeGradientFillParity,
  describeGradientReadiness,
} from './ImageGradientFill';

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function pixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

describe('ImageGradientFill', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a linear foreground-to-background gradient between the drag endpoints', () => {
    const result = applyGradientToImageData(makeImageData(3, 1), {
      from: { x: 0, y: 0 },
      to: { x: 2, y: 0 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      opacity: 1,
      mode: 'linear',
    });

    const left = pixel(result, 0, 0);
    const middle = pixel(result, 1, 0);
    const right = pixel(result, 2, 0);

    expect(left[0]).toBeGreaterThan(left[2]);
    expect(right[2]).toBeGreaterThan(right[0]);
    expect(middle[0]).toBeGreaterThan(0);
    expect(middle[2]).toBeGreaterThan(0);
  });

  it('interpolates a bounded three-stop gradient through the middle stop', () => {
    const result = applyGradientToImageData(makeImageData(5, 1), {
      from: { x: 0, y: 0 },
      to: { x: 4, y: 0 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      colorStops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' },
      ],
      opacity: 1,
      mode: 'linear',
    } as Parameters<typeof applyGradientToImageData>[1] & {
      colorStops: Array<{ offset: number; color: string }>;
    });

    expect(pixel(result, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(result, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(result, 4, 0)).toEqual([0, 0, 255, 255]);
  });

  it('renders a radial gradient from the origin point toward the drag radius', () => {
    const result = applyGradientToImageData(makeImageData(5, 5), {
      from: { x: 2, y: 2 },
      to: { x: 4, y: 2 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      opacity: 1,
      mode: 'radial',
    });

    const center = pixel(result, 2, 2);
    const edge = pixel(result, 4, 2);

    expect(center[0]).toBeGreaterThan(center[2]);
    expect(edge[2]).toBeGreaterThan(edge[0]);
  });

  it('renders a reflected gradient mirrored around the drag origin', () => {
    const result = applyGradientToImageData(makeImageData(5, 1), {
      from: { x: 2, y: 0 },
      to: { x: 4, y: 0 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      opacity: 1,
      mode: 'reflected' as never,
    });

    expect(pixel(result, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(result, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(result, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(result, 1, 0)[0]).toBeGreaterThan(0);
    expect(pixel(result, 1, 0)[2]).toBeGreaterThan(0);
  });

  it('renders a diamond gradient using distance on both drag axes', () => {
    const result = applyGradientToImageData(makeImageData(5, 5), {
      from: { x: 2, y: 2 },
      to: { x: 4, y: 2 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      opacity: 1,
      mode: 'diamond' as never,
    });

    expect(pixel(result, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(result, 4, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(result, 2, 4)).toEqual([0, 0, 255, 255]);
    expect(pixel(result, 3, 2)[0]).toBeGreaterThan(0);
    expect(pixel(result, 3, 2)[2]).toBeGreaterThan(0);
  });

  it('renders an angle gradient around the drag origin using the drag direction as zero degrees', () => {
    const result = applyGradientToImageData(makeImageData(3, 3), {
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      startColor: '#ff0000',
      endColor: '#0000ff',
      opacity: 1,
      mode: 'angle',
    });

    const right = pixel(result, 2, 1);
    const down = pixel(result, 1, 2);
    const left = pixel(result, 0, 1);
    const up = pixel(result, 1, 0);

    expect(right[0]).toBeGreaterThan(right[2]);
    expect(down[0]).toBeGreaterThan(0);
    expect(down[2]).toBeGreaterThan(0);
    expect(left[0]).toBeGreaterThan(0);
    expect(left[2]).toBeGreaterThan(0);
    expect(up[2]).toBeGreaterThan(up[0]);
  });

  it('returns a real ImageData instance when the runtime provides ImageData', () => {
    class FakeImageData {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }

    vi.stubGlobal('ImageData', FakeImageData);

    const result = applyGradientToImageData(makeImageData(2, 1), {
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      startColor: '#ffffff',
      endColor: '#000000',
      opacity: 1,
      mode: 'linear',
    });

    expect(result).toBeInstanceOf(FakeImageData);
  });

  it('builds deterministic fill parity metadata for custom transparent multi-stop gradients', () => {
    const descriptor = describeGradientFillParity({
      from: { x: 12.345, y: 4.5 },
      to: { x: 80, y: 40 },
      startColor: '#00ff00',
      endColor: '#00ff00',
      colorStops: [
        { offset: 1, color: '#0000ff', opacity: 0.2 },
        { offset: -0.25, color: '#ff0000', opacity: 1.5 },
        { offset: 0.5, color: '#00ff00', opacity: 0.75 },
      ],
      opacity: 0.6,
      mode: 'radial',
      startOpacity: 1,
      endOpacity: 0,
    });

    expect(descriptor).toEqual({
      descriptorId: 'image-gradient-fill:v1',
      version: 1,
      kind: 'custom-multi-stop',
      mode: 'radial',
      support: 'supported',
      geometry: {
        from: { x: 12.35, y: 4.5 },
        to: { x: 80, y: 40 },
        radius: 76.4,
        length: 76.4,
      },
      stops: [
        { offset: 0, color: '#ff0000', opacity: 0.6, sourceOpacity: 1 },
        { offset: 0.5, color: '#00ff00', opacity: 0.45, sourceOpacity: 0.75 },
        { offset: 1, color: '#0000ff', opacity: 0.12, sourceOpacity: 0.2 },
      ],
      alpha: {
        overallOpacity: 0.6,
        startOpacity: 0.6,
        endOpacity: 0,
        compositing: 'source-over-alpha',
        preservesBaseAlpha: true,
      },
      capabilities: {
        linear: true,
        radial: true,
        angle: true,
        reflected: true,
        diamond: true,
        customMultiStop: true,
        foregroundToTransparent: true,
        reverse: true,
        dither: false,
      },
      preview: {
        id: 'gradient-preview:radial:custom-multi-stop:12.35,4.5:80,40:3',
        signature: 'image-gradient-fill:v1|radial|custom-multi-stop|12.35,4.5|80,40|0:#ff0000@0.6|0.5:#00ff00@0.45|1:#0000ff@0.12|alpha:0.6/0|dither:false',
      },
      unsupported: [
        { feature: 'mesh-gradient', status: 'unsupported', caveat: 'Mesh gradients are not represented by the raster gradient fill path.' },
        { feature: 'noise-gradient', status: 'unsupported', caveat: 'Noise gradients are not procedurally generated by this fill path.' },
      ],
      export: {
        renderPath: 'rasterized-canvas-image-data',
        portablePreset: true,
        caveats: [
          'Gradient fills are applied destructively to layer pixels; editable native gradient layers are not exported.',
          'Dither is available but disabled for this fill.',
          'Unsupported mesh and noise gradients require raster fallback before export.',
        ],
      },
    });
  });

  it('applies deterministic ordered dithering across rows that share the same gradient amount', () => {
    const undithered = applyGradientToImageData(makeImageData(4, 4), {
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
      startColor: '#000000',
      endColor: '#ffffff',
      opacity: 1,
      mode: 'linear',
    });
    const dithered = applyGradientToImageData(makeImageData(4, 4), {
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
      startColor: '#000000',
      endColor: '#ffffff',
      opacity: 1,
      mode: 'linear',
      dither: true,
    } as Parameters<typeof applyGradientToImageData>[1] & { dither: boolean });

    expect(pixel(undithered, 1, 0)).toEqual(pixel(undithered, 1, 1));
    expect(pixel(dithered, 1, 0)).not.toEqual(pixel(dithered, 1, 1));
    expect(pixel(dithered, 1, 0)[0]).not.toBe(pixel(undithered, 1, 0)[0]);
    expect(pixel(dithered, 1, 1)[0]).not.toBe(pixel(undithered, 1, 1)[0]);
  });

  it('describes dithered gradient fills as supported instead of metadata-only unsupported', () => {
    const descriptor = describeGradientFillParity({
      from: { x: 0, y: 0 },
      to: { x: 8, y: 0 },
      startColor: '#000000',
      endColor: '#ffffff',
      opacity: 1,
      mode: 'linear',
      dither: true,
    } as Parameters<typeof describeGradientFillParity>[0] & { dither: boolean });

    expect(descriptor.capabilities.dither).toBe(true);
    expect(descriptor.preview.signature).toContain('dither:true');
    expect(descriptor.export.caveats).not.toContain('Dither is metadata-only and not applied by the renderer.');
  });

  it('summarizes deterministic gradient readiness without native editable layer claims', () => {
    const readiness = describeGradientReadiness({
      from: { x: 1.234, y: 2 },
      to: { x: 9, y: 5.678 },
      startColor: '#123',
      endColor: '#abcdef',
      opacity: 0.8,
      mode: 'angle',
      dither: true,
    });

    expect(readiness.modes).toEqual({
      linear: { status: 'supported', previewSignatureSegment: 'mode:linear' },
      radial: { status: 'supported', previewSignatureSegment: 'mode:radial' },
      angle: { status: 'supported', previewSignatureSegment: 'mode:angle' },
      reflected: { status: 'supported', previewSignatureSegment: 'mode:reflected' },
      diamond: { status: 'supported', previewSignatureSegment: 'mode:diamond' },
    });
    expect(readiness.nativeGradientLayer).toEqual({
      status: 'unsupported',
      caveat: 'Editable native Photoshop-style gradient fill layers are not retained; fills are rasterized into layer pixels.',
    });
    expect(readiness.unsupported).toEqual([
      { feature: 'mesh-gradient', status: 'unsupported', caveat: 'Mesh gradients are not represented by the raster gradient fill path.' },
      { feature: 'noise-gradient', status: 'unsupported', caveat: 'Noise gradients are not procedurally generated by this fill path.' },
    ]);
    expect(readiness.gradientMap).toEqual({
      status: 'caveat',
      caveat: 'Gradient Map tonal remapping belongs to adjustment-layer planning, not the pixel gradient fill path.',
    });
    expect(readiness.preview.fillSignature).toBe(
      'image-gradient-fill:v1|angle|linear-two-color|1.23,2|9,5.68|0:#112233@0.8|1:#abcdef@0.8|alpha:0.8/0.8|dither:true',
    );
    expect(readiness.preview.readinessSignature).toBe(
      'image-gradient-readiness:v1|mode:angle|stops:2|preset:portable|transparency:false|dither:true|native-layer:unsupported|unsupported:mesh-gradient,noise-gradient',
    );
    expect(readiness.export.caveats).toEqual([
      'Gradient output is flattened through raster canvas ImageData for preview and export.',
      'Editable native gradient layer parameters are not preserved across export.',
      'Mesh, noise, and Gradient Map workflows require separate raster or adjustment-layer fallbacks.',
    ]);
  });

  it('reports preset, stop, transparency, and dither readiness from normalized stops', () => {
    const readiness = describeGradientReadiness({
      from: { x: 0, y: 0 },
      to: { x: 12, y: 0 },
      startColor: '#000000',
      endColor: '#ffffff',
      colorStops: [
        { offset: 1, color: '#ffffff', opacity: 1 },
        { offset: 0.4, color: '#ff0000', opacity: 0.25 },
        { offset: 0, color: '#000000', opacity: 0 },
      ],
      opacity: 0.5,
      mode: 'linear',
      dither: false,
    });

    expect(readiness.preset).toEqual({
      status: 'supported',
      portable: true,
      caveat: 'Preset identity is portable as normalized colors/stops, not as a native Photoshop preset object.',
    });
    expect(readiness.stops).toEqual({
      status: 'supported',
      count: 3,
      arbitraryOffsets: true,
      perStopOpacity: true,
      hasTransparency: true,
      signature: '0:#000000@0|0.4:#ff0000@0.125|1:#ffffff@0.5',
    });
    expect(readiness.dither).toEqual({
      status: 'supported-disabled',
      deterministic: true,
      caveat: 'Ordered dithering is available and deterministic, but disabled for this descriptor.',
    });
  });

  it('describes gradient action readiness with selection routing, invalid blockers, and Photoshop caveats', () => {
    const readiness = describeGradientActionReadiness({
      options: {
        from: { x: 8, y: 4 },
        to: { x: 8, y: 4 },
        startColor: '#336699',
        endColor: '#ffffff',
        colorStops: [
          { offset: 0, color: '#336699', opacity: 1 },
          { offset: 1, color: '#ffffff', opacity: 0 },
        ],
        opacity: 1.25,
        mode: 'linear',
        dither: true,
      },
      hasSelection: true,
      selectionFeather: 2,
      target: 'layer-mask',
      activeChannel: 'alpha',
      batch: true,
      actionRecording: true,
      requestedNativeGradientLayer: true,
      requestedGradientMap: true,
      hasWritableLayer: false,
    });

    expect(readiness.descriptorId).toBe('image-gradient-action-readiness:v1');
    expect(readiness.selection).toEqual({
      route: 'selection-mask-clipped',
      hasSelection: true,
      featherPixels: 2,
      caveat: 'Gradient output is clipped by the current selection mask before writing to the target pixels.',
    });
    expect(readiness.alpha).toEqual({
      transparentStops: true,
      overallOpacity: 1,
      writesTransparentPixels: true,
      preservesExistingTransparentPixels: false,
      caveat: 'Transparent gradient stops lower source opacity during source-over compositing; existing transparent pixels can still receive color unless layer transparency is separately locked.',
    });
    expect(readiness.target).toEqual({
      requested: 'layer-mask',
      writePath: 'active-layer-mask-alpha',
      activeChannel: 'alpha',
      caveats: [
        'Layer mask targets use alpha-mask writes; color stops are converted to luminance/alpha mask intent.',
        'Alpha channel routing is descriptor-only for gradient fills; saved alpha channels are not directly written by this helper.',
      ],
    });
    expect(readiness.blockers).toEqual([
      { code: 'zero-length-gradient', severity: 'blocker', message: 'Gradient drag endpoints must not be identical.' },
      { code: 'missing-writable-layer', severity: 'blocker', message: 'A writable active layer or mask target is required before applying a gradient fill.' },
      { code: 'opacity-out-of-range', severity: 'blocker', message: 'Gradient opacity must be between 0 and 1 before execution.' },
    ]);
    expect(readiness.unsupported.map((entry) => entry.feature)).toEqual([
      'mesh-gradient',
      'noise-gradient',
      'native-gradient-fill-layer',
      'gradient-map-adjustment',
    ]);
    expect(readiness.batch).toEqual({
      suitable: false,
      actionRecordable: true,
      exportSignature: 'image-gradient-action-batch:v1|image-gradient-fill:v1|linear|custom-multi-stop|8,4|8,4|0:#336699@1|1:#ffffff@0|alpha:1/1|dither:true|target:layer-mask|channel:alpha|selection:selection-mask-clipped',
      caveats: [
        'Batch gradient fills require deterministic endpoints and a writable target for every document.',
        'Recorded actions can replay normalized endpoints, colors, stops, opacity, mode, selection routing, and dither state.',
      ],
    });
    expect(readiness.preview.signature).toBe(
      'image-gradient-action-readiness:v1|image-gradient-fill:v1|linear|custom-multi-stop|8,4|8,4|0:#336699@1|1:#ffffff@0|alpha:1/1|dither:true|selection:selection-mask-clipped|target:layer-mask|channel:alpha|blockers:zero-length-gradient,missing-writable-layer,opacity-out-of-range|batch:false',
    );
  });

  it('captures source-bin export signatures and action suitability for rasterized gradient fills', () => {
    const readiness = describeGradientReadiness({
      from: { x: 0, y: 0 },
      to: { x: 40, y: 10 },
      startColor: '#112233',
      endColor: '#112233',
      colorStops: [
        { offset: 0, color: '#112233', opacity: 1 },
        { offset: 0.25, color: '#445566', opacity: 0.6 },
        { offset: 1, color: '#aabbcc', opacity: 0.1 },
      ],
      opacity: 0.5,
      mode: 'diamond',
      dither: true,
    });
    const action = describeGradientActionReadiness({
      options: {
        from: { x: 0, y: 0 },
        to: { x: 40, y: 10 },
        startColor: '#112233',
        endColor: '#112233',
        colorStops: [
          { offset: 0, color: '#112233', opacity: 1 },
          { offset: 0.25, color: '#445566', opacity: 0.6 },
          { offset: 1, color: '#aabbcc', opacity: 0.1 },
        ],
        opacity: 0.5,
        mode: 'diamond',
        dither: true,
      },
      target: 'quick-mask',
      activeChannel: 'spot',
      batch: true,
      actionRecording: true,
      hasWritableLayer: true,
    });

    expect(readiness.export).toMatchObject({
      flattening: 'rasterized-canvas-image-data',
      sourceBinAsset: {
        kind: 'flattened-gradient-fill',
        previewSignature: 'image-gradient-fill:v1|diamond|custom-multi-stop|0,0|40,10|0:#112233@0.5|0.25:#445566@0.3|1:#aabbcc@0.05|alpha:0.5/0.5|dither:true',
        exportSignature: 'image-gradient-export:v1|fill:image-gradient-fill:v1|diamond|custom-multi-stop|0,0|40,10|0:#112233@0.5|0.25:#445566@0.3|1:#aabbcc@0.05|alpha:0.5/0.5|dither:true|flatten:rasterized-canvas-image-data|native-layer:false',
      },
    });
    expect(action.batch).toEqual({
      suitable: true,
      actionRecordable: true,
      exportSignature: 'image-gradient-action-batch:v1|image-gradient-fill:v1|diamond|custom-multi-stop|0,0|40,10|0:#112233@0.5|0.25:#445566@0.3|1:#aabbcc@0.05|alpha:0.5/0.5|dither:true|target:quick-mask|channel:spot|selection:full-layer',
      caveats: [
        'Batch gradient fills require deterministic endpoints and a writable target for every document.',
        'Recorded actions can replay normalized endpoints, colors, stops, opacity, mode, selection routing, and dither state.',
      ],
    });
    expect(action.target.caveats).toContain(
      'Spot channel routing is unsupported for gradient fills; convert through composite RGBA or spot-channel workflows.',
    );
  });
});
