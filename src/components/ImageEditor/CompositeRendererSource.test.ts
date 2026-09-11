import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlendMode, ImageDocument } from '../../types/imageEditor';
import {
  CompositeRenderer,
  describeImageBlendModeParity,
  describeImageBlendModePortabilityReadiness,
  getImageBlendModeCapabilityGroups,
  getImageBlendModeCapability,
  getUnsupportedImageBlendModeWarnings,
  IMAGE_BLEND_MODE_CAPABILITIES,
  imageBlendModeToCanvasCompositeOperation,
} from './CompositeRenderer';

const EXPECTED_BLEND_MODE_ORDER: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

describe('CompositeRenderer source guards', () => {
  it('invalidates the composite cache when layer type or clipping semantics change', () => {
    const signature = (
      CompositeRenderer.prototype as unknown as {
        buildDocSignature: (doc: ImageDocument) => string;
      }
    ).buildDocSignature;
    const document = (type: 'image' | 'group', clippingMask: boolean): ImageDocument => ({
      width: 2,
      height: 2,
      layers: [{
        id: 'same-layer',
        name: 'Same layer',
        type,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: null,
        bitmapVersion: 0,
        mask: null,
        clippingMask,
      }],
    } as ImageDocument);

    const plain = signature.call({}, document('image', false));
    const grouped = signature.call({}, document('group', false));
    const clipped = signature.call({}, document('image', true));

    expect(grouped).not.toBe(plain);
    expect(clipped).not.toBe(plain);
    expect(JSON.parse(grouped).layers[0]).toMatchObject({ type: 'group', clippingMask: false });
    expect(JSON.parse(clipped).layers[0]).toMatchObject({ type: 'image', clippingMask: true });
  });

  it('describes supported blend modes deterministically with preview and export parity', () => {
    expect(IMAGE_BLEND_MODE_CAPABILITIES.map((descriptor) => descriptor.mode)).toEqual(EXPECTED_BLEND_MODE_ORDER);
    expect(new Set(IMAGE_BLEND_MODE_CAPABILITIES.map((descriptor) => descriptor.mode)).size).toBe(EXPECTED_BLEND_MODE_ORDER.length);

    expect(getImageBlendModeCapability('normal')).toMatchObject({
      mode: 'normal',
      label: 'Normal',
      canvasCompositeOperation: 'source-over',
      preview: { supported: true, compositeOperation: 'source-over' },
      export: { supported: true, compositeOperation: 'source-over' },
      warnings: [],
    });
    expect(getImageBlendModeCapability('color-dodge')).toMatchObject({
      mode: 'color-dodge',
      label: 'Color Dodge',
      canvasCompositeOperation: 'color-dodge',
      preview: { supported: true, compositeOperation: 'color-dodge' },
      export: { supported: true, compositeOperation: 'color-dodge' },
      warnings: [],
    });

    for (const descriptor of IMAGE_BLEND_MODE_CAPABILITIES) {
      expect(descriptor.preview).toEqual({
        supported: true,
        compositeOperation: descriptor.canvasCompositeOperation,
      });
      expect(descriptor.export).toEqual({
        supported: true,
        compositeOperation: descriptor.canvasCompositeOperation,
      });
    }
  });

  it('maps layer blend modes to the canvas operation used by renderer payloads', () => {
    expect(imageBlendModeToCanvasCompositeOperation('normal')).toBe('source-over');
    expect(imageBlendModeToCanvasCompositeOperation('multiply')).toBe('multiply');
    expect(imageBlendModeToCanvasCompositeOperation('luminosity')).toBe('luminosity');
  });

  it('reports unsupported advanced blending warnings in deterministic order', () => {
    expect(getUnsupportedImageBlendModeWarnings()).toEqual([]);
    expect(getUnsupportedImageBlendModeWarnings({
      advancedBlending: true,
      blendIf: true,
    })).toEqual([
      'Blend If source/underlying tonal range splitting is not supported yet; flatten or rasterize those advanced blending settings before relying on Image preview/export parity.',
      'Advanced blending options such as channel targeting, knockout, and fill opacity are not supported yet; only layer opacity and canvas-native blend modes are previewed and exported.',
    ]);
  });

  it('publishes blend-mode support groups, canvas mappings, and parity signatures', () => {
    expect(getImageBlendModeCapabilityGroups()).toEqual([
      {
        id: 'basic',
        label: 'Basic canvas blend modes',
        modes: ['normal', 'multiply', 'screen', 'overlay'],
        supported: true,
        caveats: [],
      },
      {
        id: 'contrast',
        label: 'Contrast and comparison blend modes',
        modes: ['darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'],
        supported: true,
        caveats: [
          'Canvas blend math is browser-managed and may not exactly match Photoshop in non-sRGB, high-bit-depth, or color-managed documents.',
        ],
      },
      {
        id: 'component',
        label: 'Component blend modes',
        modes: ['hue', 'saturation', 'color', 'luminosity'],
        supported: true,
        caveats: [
          'Hue, Saturation, Color, and Luminosity rely on Canvas 2D component blending and are treated as flattened sRGB preview/export approximations.',
        ],
      },
    ]);

    const descriptor = describeImageBlendModeParity({
      activeModes: ['normal', 'multiply', 'color', 'multiply'],
      blendIf: true,
      advancedBlending: true,
      opacity: 0.42,
      exportTarget: 'flattened',
    });

    expect(descriptor.canvasCompositeMappings).toEqual([
      { mode: 'normal', compositeOperation: 'source-over' },
      { mode: 'multiply', compositeOperation: 'multiply' },
      { mode: 'screen', compositeOperation: 'screen' },
      { mode: 'overlay', compositeOperation: 'overlay' },
      { mode: 'darken', compositeOperation: 'darken' },
      { mode: 'lighten', compositeOperation: 'lighten' },
      { mode: 'color-dodge', compositeOperation: 'color-dodge' },
      { mode: 'color-burn', compositeOperation: 'color-burn' },
      { mode: 'hard-light', compositeOperation: 'hard-light' },
      { mode: 'soft-light', compositeOperation: 'soft-light' },
      { mode: 'difference', compositeOperation: 'difference' },
      { mode: 'exclusion', compositeOperation: 'exclusion' },
      { mode: 'hue', compositeOperation: 'hue' },
      { mode: 'saturation', compositeOperation: 'saturation' },
      { mode: 'color', compositeOperation: 'color' },
      { mode: 'luminosity', compositeOperation: 'luminosity' },
    ]);
    expect(descriptor.activeModes).toEqual(['normal', 'multiply', 'color']);
    expect(descriptor.previewSignature).toContain('"activeModes":["normal","multiply","color"]');
    expect(descriptor.exportSignature).toContain('"target":"flattened"');
    expect(descriptor.unsupportedPhotoshopFeatures).toEqual([
      {
        id: 'blend-if',
        label: 'Blend If',
        supported: false,
        caveat: 'Blend If source/underlying tonal range splitting is not supported yet; flatten or rasterize those advanced blending settings before relying on Image preview/export parity.',
      },
      {
        id: 'advanced-blending',
        label: 'Advanced Blending',
        supported: false,
        caveat: 'Advanced blending options such as channel targeting, knockout, and fill opacity are not supported yet; only layer opacity and canvas-native blend modes are previewed and exported.',
      },
    ]);
    expect(descriptor.alphaOpacityCaveats).toEqual([
      {
        id: 'layer-opacity',
        label: 'Layer opacity',
        value: 0.42,
        caveat: 'Layer opacity is applied through CanvasRenderingContext2D.globalAlpha before blend compositing; Photoshop fill opacity and per-channel opacity are not modeled.',
      },
      {
        id: 'flattened-alpha',
        label: 'Flattened export alpha',
        value: 1,
        caveat: 'Flattened blend exports preserve canvas alpha compositing but do not retain editable Photoshop blend-mode stacks.',
      },
    ]);
    expect(descriptor.knownMathLimitations).toEqual([
      'Canvas blend math is browser-managed and may not exactly match Photoshop in non-sRGB, high-bit-depth, or color-managed documents.',
      'Hue, Saturation, Color, and Luminosity rely on Canvas 2D component blending and are treated as flattened sRGB preview/export approximations.',
      'Soft Light and Color Dodge/Burn formulas are delegated to the browser Canvas implementation; parity should be validated visually for critical PSD roundtrips.',
    ]);
  });

  it('describes blend-mode portability readiness for advanced Photoshop states, source-bin export, and automation', () => {
    const descriptor = describeImageBlendModePortabilityReadiness({
      activeModes: ['normal', 'multiply', 'screen', 'multiply'],
      blendIf: true,
      fillOpacity: 0.35,
      knockout: 'deep',
      channelTargeting: ['red', 'blue'],
      exportTarget: 'source-bin',
      sourceBinLinked: true,
      batchLayerCount: 3,
    });

    expect(descriptor.id).toBe('image-blend-mode-portability-readiness:v1');
    expect(descriptor.canvasCompositeSupport).toEqual({
      supported: true,
      modes: ['normal', 'multiply', 'screen'],
      mappings: [
        { mode: 'normal', compositeOperation: 'source-over' },
        { mode: 'multiply', compositeOperation: 'multiply' },
        { mode: 'screen', compositeOperation: 'screen' },
      ],
    });
    expect(descriptor.unsupportedPhotoshopAdvancedStates).toEqual([
      expect.objectContaining({ id: 'blend-if', requested: true, supported: false }),
      expect.objectContaining({ id: 'fill-opacity', requested: true, supported: false, value: 0.35 }),
      expect.objectContaining({ id: 'knockout', requested: true, supported: false, mode: 'deep' }),
      expect.objectContaining({ id: 'channel-targeting', requested: true, supported: false, channels: ['red', 'blue'] }),
    ]);
    expect(descriptor.exportSourceBinParityCaveats).toEqual([
      expect.objectContaining({ code: 'source-bin-visible-export-flattens-blend-stack', target: 'source-bin' }),
      expect.objectContaining({ code: 'source-bin-overwrite-requires-linked-source', target: 'source-bin' }),
    ]);
    expect(descriptor.actionSuitability).toEqual({
      recordable: false,
      replayable: false,
      reasonCodes: ['advanced-blending-unsupported'],
    });
    expect(descriptor.batchSuitability).toEqual({
      status: 'blocked',
      layerCount: 3,
      reasonCodes: ['advanced-blending-unsupported', 'source-bin-linked-visible-export'],
    });
    expect(descriptor.signature).toContain('"activeModes":["normal","multiply","screen"]');
  });

  it('builds the high-res worker as a bundled module worker, never a Function.toString() blob', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');

    // The blob approach crashed in every minified build: a stringified function's internal
    // calls reference its own module's minified names, which don't exist in the blob's scope
    // (`_r is not defined`, docs/notes/820). Guard against reintroduction.
    expect(source).toContain("new Worker(new URL('./highResComposite.worker.ts', import.meta.url), { type: 'module' })");
    expect(source).not.toContain('.toString()}');
    expect(source).not.toContain('createObjectURL');
  });

  it('propagates layer skew, perspective, warp, and distort state through the worker payload and document signature', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');

    expect(source).toContain('skewXDeg: l.skewXDeg');
    expect(source).toContain('skewYDeg: l.skewYDeg');
    expect(source).toContain('perspectiveX: l.perspectiveX');
    expect(source).toContain('perspectiveY: l.perspectiveY');
    expect(source).toContain('warp: l.warp');
    expect(source).toContain('cornerOffsets: l.cornerOffsets');
    expect(source).toContain('skewXDeg: layer.skewXDeg');
    expect(source).toContain('skewYDeg: layer.skewYDeg');
    expect(source).toContain('perspectiveX: layer.perspectiveX');
    expect(source).toContain('perspectiveY: layer.perspectiveY');
    expect(source).toContain('warp: layer.warp');
    expect(source).toContain('cornerOffsets: layer.cornerOffsets');
  });

  it('propagates vector mask metadata through document signatures and high-res worker payload composition', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');

    expect(source).toContain('vectorMask: getLayerVectorMaskMetadata(l)');
    expect(source).toContain('composeLayerBitmapWithLiveMasks(layer)');
  });

  it('worker module imports the real transform + adjustment helpers (warp chain rides drawLayerBitmapTransformed)', () => {
    const worker = readFileSync(join(process.cwd(), 'src/components/ImageEditor/highResComposite.worker.ts'), 'utf8');

    expect(worker).toContain("import { applyAdjustmentToImageData } from './ImageAdjustmentLayer'");
    expect(worker).toContain('drawLayerBitmapTransformed');
    expect(worker).toContain("from './ImageLayerTransform'");
    expect(worker).toContain('transferToImageBitmap');
  });

  it('routes mounted and worker native previews through target admission before a full composite', () => {
    const mounted = readFileSync(join(process.cwd(), 'src/components/ImageEditor/pixels/nativeDisplay.ts'), 'utf8');
    const worker = readFileSync(join(process.cwd(), 'src/components/ImageEditor/highResComposite.worker.ts'), 'utf8');

    expect(mounted).toContain('compositePixelBuffersForTarget(layers, doc.width, doc.height)');
    expect(worker).toContain('compositePixelBuffersForTarget(event.data.nativeLayers, docWidth, docHeight)');
    expect(mounted).not.toContain('compositePixelBuffers(layers)');
    expect(worker).not.toContain('compositePixelBuffers(event.data.nativeLayers)');
    expect(worker.indexOf('if (event.data.nativeLayers)'))
      .toBeLessThan(worker.indexOf('const canvas = new OffscreenCanvas(docWidth, docHeight);'));
    expect(worker.indexOf('compositePixelBuffersForTarget(event.data.nativeLayers, docWidth, docHeight)'))
      .toBeLessThan(worker.indexOf('const canvas = new OffscreenCanvas(docWidth, docHeight);'));
  });

  it('keeps native worker admission and failure paths recoverable', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');
    const worker = readFileSync(join(process.cwd(), 'src/components/ImageEditor/highResComposite.worker.ts'), 'utf8');
    const nativeDisplay = readFileSync(join(process.cwd(), 'src/components/ImageEditor/pixels/nativeDisplay.ts'), 'utf8');
    expect(source).toContain('checkNativeWorkerMemoryAdmission');
    expect(nativeDisplay).toContain('compositePixelBuffersForTarget');
    expect(worker).toContain('compositePixelBuffersForTarget');
    expect(worker).toContain('refusal: { code: error.code, message: error.message }');
    expect(source).toContain('this.isWorkerRunning = false');
    expect(source).toContain('this.workerDocSignature = null');
    expect(source).toContain('refusalFromWorkerEnvelope');
    expect(source).toContain('e.data.refusal');
    expect(source).toContain('if (e.data.error)');
    expect(source).toContain('this.workerObj.postMessage');
    expect(source).toContain('reject(error)');
    expect(worker).toContain('could not acquire a 2D context');
  });
});
