import { describe, expect, it } from 'vitest';
import type { ImageLayerFilter } from '../../types/imageEditor';
import {
  applyLayerFiltersToImageData,
  applyLayerFilterStackEditOperation,
  createLayerFilterMask,
  setLayerFilterMaskCoverage,
  createDefaultLayerFilter,
  describeLayerFilterActionReadiness,
  describeLayerFilterStack,
  describeLayerFilterStackInterop,
  describeEditableFilterStackReadiness,
  getUnsupportedLayerFilterWarnings,
  materializeLayerFilterStackPreset,
  serializeLayerFilterStackPreset,
} from './ImageLayerFilters';

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

function makeFilters(...filters: ImageLayerFilter[]): ImageLayerFilter[] {
  return filters;
}

describe('ImageLayerFilters', () => {
  it('builds deterministic filter stack descriptors with order, bounds, and preview signatures', () => {
    const filters = makeFilters(
      { id: 'noise-a', kind: 'noise', enabled: false, amount: 12, opacity: 0.3, blendMode: 'screen' },
      { id: 'blur-a', kind: 'blur', enabled: true, amount: 2.4, opacity: 0.5, blendMode: 'multiply' },
      { id: 'gray-a', kind: 'grayscale', enabled: true, amount: 100, opacity: 1, blendMode: 'normal' },
    );

    const descriptor = describeLayerFilterStack(filters, {
      sourceBounds: { x: 10, y: 20, width: 50, height: 30 },
    });

    expect(descriptor.affectedBounds).toEqual({ x: 8, y: 18, width: 54, height: 34 });
    expect(descriptor.previewSignature).toBe(
      'filter-stack:v1:[{"order":0,"id":"noise-a","kind":"noise","enabled":false,"amount":12,"opacity":0.3,"blendMode":"screen","bounds":{"x":10,"y":20,"width":50,"height":30}},{"order":1,"id":"blur-a","kind":"blur","enabled":true,"amount":2.4,"opacity":0.5,"blendMode":"multiply","bounds":{"x":8,"y":18,"width":54,"height":34}},{"order":2,"id":"gray-a","kind":"grayscale","enabled":true,"amount":100,"opacity":1,"blendMode":"normal","bounds":{"x":8,"y":18,"width":54,"height":34}}]',
    );
    expect(descriptor.filters).toEqual([
      expect.objectContaining({
        id: 'noise-a',
        order: 0,
        label: 'Noise',
        enabled: false,
        opacity: 0.3,
        blendMode: 'screen',
        affectedBounds: { x: 10, y: 20, width: 50, height: 30 },
      }),
      expect.objectContaining({
        id: 'blur-a',
        order: 1,
        label: 'Blur',
        enabled: true,
        opacity: 0.5,
        blendMode: 'multiply',
        affectedBounds: { x: 8, y: 18, width: 54, height: 34 },
      }),
      expect.objectContaining({
        id: 'gray-a',
        order: 2,
        label: 'Grayscale',
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        affectedBounds: { x: 8, y: 18, width: 54, height: 34 },
      }),
    ]);
    expect(describeLayerFilterStack(filters, {
      sourceBounds: { x: 10, y: 20, width: 50, height: 30 },
    }).previewSignature).toBe(descriptor.previewSignature);
  });

  it('warns about unsupported smart-filter masks and non-destructive parameter types', () => {
    expect(getUnsupportedLayerFilterWarnings({
      smartFilterMask: 'present',
      parameterTypes: ['amount', 'curve', 'channel-map'],
    })).toEqual([
      'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
      'Non-destructive curve filter parameters are not supported yet; only scalar amount parameters are editable in Image filter stacks.',
      'Non-destructive channel-map filter parameters are not supported yet; only scalar amount parameters are editable in Image filter stacks.',
    ]);
  });

  it('keeps owned per-filter alpha masks editable locally and refuses lossy preset export', () => {
    const filters = makeFilters({
      id: 'masked-blur',
      kind: 'blur',
      enabled: true,
      amount: 3,
      opacity: 1,
      blendMode: 'normal',
      mask: { width: 2, height: 1, alpha: [0, 255] },
    });

    const descriptor = describeLayerFilterStackInterop(filters, {
      sourceBounds: { x: 0, y: 0, width: 2, height: 1 },
      smartFilterMask: 'local',
      exportTarget: 'flattened',
    });

    expect(descriptor.smartFilterMask).toEqual({
      status: 'editable-local',
      warning: 'Per-filter alpha masks stay editable and composited in Sloom Studio; native Photoshop Smart Filter masks are not round-tripped.',
    });
    expect(descriptor.previewReadiness).toEqual({
      status: 'ready',
      liveCanvasPreview: true,
      stackSignature: descriptor.previewSignature,
      gaps: [],
    });
    expect(descriptor.previewSignature).toContain('"mask":"layer-filter-mask:v1:2x1:2:d277c7a0"');
    expect(descriptor.exportSignature).toContain('"mask":"layer-filter-mask:v1:2x1:2:d277c7a0"');
    expect(descriptor.controlReadiness.smartFilterMask).toBe(true);
    expect(descriptor.nonDestructiveLimits).toContain(
      'Editable stacks preserve order, amount, opacity, blend mode, enabled state, and owned per-filter alpha masks.',
    );
    expect(descriptor.smartFilterStyleLimits).toContainEqual(expect.objectContaining({
      id: 'mask',
      editable: true,
      portability: 'flattened-handoff',
    }));
    expect(descriptor.exportFlattening.warnings).toContain(
      'Per-filter alpha masks and advanced parameters bake into flattened output; native Smart Filter roundtrip is unsupported.',
    );
    expect(serializeLayerFilterStackPreset('Masked', filters, { smartFilterMask: 'local' })).toBeNull();
    expect(describeLayerFilterStackInterop([
      { ...filters[0], mask: { width: 2, height: 1, alpha: [255, 0] } },
    ], { smartFilterMask: 'local', exportTarget: 'flattened' }).previewSignature).not.toBe(descriptor.previewSignature);
    expect(describeLayerFilterStackInterop([
      { ...filters[0], mask: { width: 99_999_999, height: 99_999_999, alpha: [] } },
    ], { smartFilterMask: 'local' }).previewSignature).toContain('layer-filter-mask:v1:invalid:99999999x99999999:0');
  });

  it('serializes clean filter stack presets without volatile ids', () => {
    const filters = makeFilters(
      { id: 'blur-runtime-id', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'normal' },
      { id: 'sepia-runtime-id', kind: 'sepia', enabled: false, amount: 25, opacity: 1, blendMode: 'soft-light' },
    );

    expect(serializeLayerFilterStackPreset(' Soft portrait ', filters, {
      sourceBounds: { x: 0, y: 0, width: 10, height: 8 },
    })).toEqual({
      version: 1,
      label: 'Soft portrait',
      filters: [
        { kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'normal' },
        { kind: 'sepia', enabled: false, amount: 25, opacity: 1, blendMode: 'soft-light' },
      ],
      previewSignature:
        'filter-stack:v1:[{"order":0,"kind":"blur","enabled":true,"amount":4,"opacity":0.75,"blendMode":"normal","bounds":{"x":-4,"y":-4,"width":18,"height":16}},{"order":1,"kind":"sepia","enabled":false,"amount":25,"opacity":1,"blendMode":"soft-light","bounds":{"x":-4,"y":-4,"width":18,"height":16}}]',
    });

    expect(serializeLayerFilterStackPreset('Masked', filters, {
      smartFilterMask: 'present',
    })).toBeNull();
  });

  it('materializes portable filter stack presets with deterministic ids and replay signatures', () => {
    const preset = serializeLayerFilterStackPreset(' Action Stack ', makeFilters(
      { id: 'runtime-blur', kind: 'blur', enabled: true, amount: 3, opacity: 0.6, blendMode: 'soft-light' },
      { id: 'runtime-invert', kind: 'invert', enabled: false, amount: 100, opacity: 1, blendMode: 'normal' },
    ));

    expect(preset).not.toBeNull();

    const materialized = preset ? materializeLayerFilterStackPreset(preset, {
      idPrefix: 'portrait',
      sourceBounds: { x: 0, y: 0, width: 16, height: 10 },
    }) : null;

    expect(materialized).toEqual({
      filters: [
        { id: 'portrait-blur-0', kind: 'blur', enabled: true, amount: 3, opacity: 0.6, blendMode: 'soft-light' },
        { id: 'portrait-invert-1', kind: 'invert', enabled: false, amount: 100, opacity: 1, blendMode: 'normal' },
      ],
      presetSignature:
        'filter-stack:v1:[{"order":0,"kind":"blur","enabled":true,"amount":3,"opacity":0.6,"blendMode":"soft-light","bounds":{"x":-3,"y":-3,"width":22,"height":16}},{"order":1,"kind":"invert","enabled":false,"amount":100,"opacity":1,"blendMode":"normal","bounds":{"x":-3,"y":-3,"width":22,"height":16}}]',
      replaySignature:
        'layer-filter-preset-replay:v1:{"label":"Action Stack","filterKinds":["blur","invert"],"filterIds":["portrait-blur-0","portrait-invert-1"],"previewSignature":"filter-stack:v1:[{\\"order\\":0,\\"kind\\":\\"blur\\",\\"enabled\\":true,\\"amount\\":3,\\"opacity\\":0.6,\\"blendMode\\":\\"soft-light\\",\\"bounds\\":{\\"x\\":-3,\\"y\\":-3,\\"width\\":22,\\"height\\":16}},{\\"order\\":1,\\"kind\\":\\"invert\\",\\"enabled\\":false,\\"amount\\":100,\\"opacity\\":1,\\"blendMode\\":\\"normal\\",\\"bounds\\":{\\"x\\":-3,\\"y\\":-3,\\"width\\":22,\\"height\\":16}}]"}',
      warnings: [],
    });
  });

  it('applies deterministic stack edits for order, opacity, blend mode, enabled state, and amount', () => {
    const filters = makeFilters(
      { id: 'blur-a', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal' },
      { id: 'noise-a', kind: 'noise', enabled: false, amount: 18, opacity: 0.4, blendMode: 'overlay' },
      { id: 'gray-a', kind: 'grayscale', enabled: true, amount: 100, opacity: 1, blendMode: 'normal' },
    );

    const reordered = applyLayerFilterStackEditOperation(filters, {
      type: 'reorder',
      filterId: 'gray-a',
      toIndex: 0,
    }, {
      sourceBounds: { x: 2, y: 2, width: 12, height: 8 },
    });

    expect(reordered.filters.map((filter) => filter.id)).toEqual(['gray-a', 'blur-a', 'noise-a']);
    expect(reordered.changed).toBe(true);
    expect(reordered.blockers).toEqual([]);
    expect(reordered.signatures.order).toBe(
      'layer-filter-order:v1:[{"order":0,"kind":"grayscale","enabled":true},{"order":1,"kind":"blur","enabled":true},{"order":2,"kind":"noise","enabled":false}]',
    );

    const blended = applyLayerFilterStackEditOperation(reordered.filters, {
      type: 'set-blend-mode',
      filterId: 'blur-a',
      blendMode: 'multiply',
    }, {
      sourceBounds: { x: 2, y: 2, width: 12, height: 8 },
    });
    const opacity = applyLayerFilterStackEditOperation(blended.filters, {
      type: 'set-opacity',
      filterId: 'blur-a',
      opacity: 0.35,
    }, {
      sourceBounds: { x: 2, y: 2, width: 12, height: 8 },
    });
    const amount = applyLayerFilterStackEditOperation(opacity.filters, {
      type: 'set-amount',
      filterId: 'noise-a',
      amount: 22,
    }, {
      sourceBounds: { x: 2, y: 2, width: 12, height: 8 },
    });
    const enabled = applyLayerFilterStackEditOperation(amount.filters, {
      type: 'set-enabled',
      filterId: 'noise-a',
      enabled: true,
    }, {
      sourceBounds: { x: 2, y: 2, width: 12, height: 8 },
    });

    expect(enabled.filters).toEqual([
      { id: 'gray-a', kind: 'grayscale', enabled: true, amount: 100, opacity: 1, blendMode: 'normal' },
      { id: 'blur-a', kind: 'blur', enabled: true, amount: 4, opacity: 0.35, blendMode: 'multiply' },
      { id: 'noise-a', kind: 'noise', enabled: true, amount: 22, opacity: 0.4, blendMode: 'overlay' },
    ]);
    expect(enabled.signatures.blend).toBe(
      'layer-filter-blend:v1:[{"order":0,"kind":"grayscale","blendMode":"normal"},{"order":1,"kind":"blur","blendMode":"multiply"},{"order":2,"kind":"noise","blendMode":"overlay"}]',
    );
    expect(enabled.signatures.opacity).toBe(
      'layer-filter-opacity:v1:[{"order":0,"kind":"grayscale","opacity":1},{"order":1,"kind":"blur","opacity":0.35},{"order":2,"kind":"noise","opacity":0.4}]',
    );
    expect(enabled.previewSignature).toBe(
      'layer-filter-preview:v1:{"filters":[{"order":0,"id":"gray-a","kind":"grayscale","enabled":true,"amount":100,"opacity":1,"blendMode":"normal","bounds":{"x":2,"y":2,"width":12,"height":8}},{"order":1,"id":"blur-a","kind":"blur","enabled":true,"amount":4,"opacity":0.35,"blendMode":"multiply","bounds":{"x":-2,"y":-2,"width":20,"height":16}},{"order":2,"id":"noise-a","kind":"noise","enabled":true,"amount":22,"opacity":0.4,"blendMode":"overlay","bounds":{"x":-2,"y":-2,"width":20,"height":16}}],"smartFilterMask":"absent"}',
    );
  });

  it('blocks invalid stack edit operations without mutating the source filters', () => {
    const filters = makeFilters(
      { id: 'blur-a', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal' },
    );

    const missing = applyLayerFilterStackEditOperation(filters, {
      type: 'set-opacity',
      filterId: 'missing',
      opacity: 0.5,
    });
    const badOpacity = applyLayerFilterStackEditOperation(filters, {
      type: 'set-opacity',
      filterId: 'blur-a',
      opacity: Number.NaN,
    });
    const badAmount = applyLayerFilterStackEditOperation(filters, {
      type: 'set-amount',
      filterId: 'blur-a',
      amount: -1,
    });
    const badIndex = applyLayerFilterStackEditOperation(filters, {
      type: 'reorder',
      filterId: 'blur-a',
      toIndex: 3,
    });

    expect(missing.blockers).toEqual([
      {
        code: 'filter-not-found',
        severity: 'blocking',
        filterId: 'missing',
        message: 'Cannot edit filter "missing" because it is not in the editable stack.',
      },
    ]);
    expect(badOpacity.blockers).toEqual([
      {
        code: 'invalid-filter-opacity',
        severity: 'blocking',
        filterId: 'blur-a',
        message: 'Blur has an invalid opacity; filter opacity must be between 0 and 1.',
      },
    ]);
    expect(badAmount.blockers).toEqual([
      {
        code: 'invalid-filter-amount',
        severity: 'blocking',
        filterId: 'blur-a',
        message: 'Blur has an invalid amount; filter amounts must be finite numbers at or above 0.',
      },
    ]);
    expect(badIndex.blockers).toEqual([
      {
        code: 'filter-order-out-of-range',
        severity: 'blocking',
        filterId: 'blur-a',
        message: 'Cannot move Blur to stack index 3; valid indexes are 0 through 0.',
      },
    ]);
    expect(missing.filters).toEqual(filters);
    expect(badOpacity.filters).toEqual(filters);
    expect(badAmount.filters).toEqual(filters);
    expect(badIndex.filters).toEqual(filters);
    expect(filters[0]).toEqual({ id: 'blur-a', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal' });
  });

  it('describes filter stack interoperability warnings and preview/export parity signatures', () => {
    const descriptor = describeLayerFilterStackInterop(makeFilters(
      { id: 'blur-runtime', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'screen' },
      { id: 'invert-runtime', kind: 'invert', enabled: false, amount: 100, opacity: 1, blendMode: 'normal' },
    ), {
      sourceBounds: { x: 2, y: 3, width: 20, height: 10 },
      smartFilterMask: 'present',
      parameterTypes: ['amount', 'curve'],
      exportTarget: 'flattened',
    });

    expect(descriptor.blendOrderSignature).toBe(
      'layer-filter-order:v1:[{"order":0,"kind":"blur","enabled":true,"opacity":0.75,"blendMode":"screen"},{"order":1,"kind":"invert","enabled":false,"opacity":1,"blendMode":"normal"}]',
    );
    expect(descriptor.previewSignature).toBe(
      'layer-filter-preview:v1:{"filters":[{"order":0,"id":"blur-runtime","kind":"blur","enabled":true,"amount":4,"opacity":0.75,"blendMode":"screen","bounds":{"x":-2,"y":-1,"width":28,"height":18}},{"order":1,"id":"invert-runtime","kind":"invert","enabled":false,"amount":100,"opacity":1,"blendMode":"normal","bounds":{"x":-2,"y":-1,"width":28,"height":18}}],"smartFilterMask":"present"}',
    );
    expect(descriptor.exportSignature).toBe(
      'layer-filter-export:v1:{"target":"flattened","filters":[{"order":0,"kind":"blur","enabled":true,"amount":4,"opacity":0.75,"blendMode":"screen","bounds":{"x":-2,"y":-1,"width":28,"height":18}},{"order":1,"kind":"invert","enabled":false,"amount":100,"opacity":1,"blendMode":"normal","bounds":{"x":-2,"y":-1,"width":28,"height":18}}],"smartFilterMask":"present","unsupportedParameters":["curve"]}',
    );
    expect(descriptor.rasterizationWarnings).toEqual([
      'Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.',
    ]);
    expect(descriptor.caveats).toEqual([
      'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
      'Non-destructive curve filter parameters are not supported yet; only scalar amount parameters are editable in Image filter stacks.',
    ]);
  });

  it('describes focused filter parity metadata for masks, caveats, readiness, portability, and flattening', () => {
    const descriptor = describeLayerFilterStackInterop(makeFilters(
      { id: 'blur-runtime', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'screen' },
      { id: 'noise-runtime', kind: 'noise', enabled: true, amount: 18, opacity: 0.4, blendMode: 'overlay' },
    ), {
      sourceBounds: { x: 2, y: 3, width: 20, height: 10 },
      smartFilterMask: 'present',
      parameterTypesByFilterId: {
        'blur-runtime': ['amount', 'kernel'],
        'noise-runtime': ['amount', 'procedural'],
      },
      exportTarget: 'flattened',
    });

    expect(descriptor.smartFilterMask).toEqual({
      status: 'unsupported',
      warning: 'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
    });
    expect(descriptor.filters).toEqual([
      expect.objectContaining({
        id: 'blur-runtime',
        family: 'geometry',
        parameterCaveats: [
          {
            parameterType: 'kernel',
            warning: 'Non-destructive kernel parameters for Blur are not supported yet; only scalar amount is editable.',
          },
        ],
      }),
      expect.objectContaining({
        id: 'noise-runtime',
        family: 'texture',
        parameterCaveats: [
          {
            parameterType: 'procedural',
            warning: 'Non-destructive procedural parameters for Noise are not supported yet; only scalar amount is editable.',
          },
        ],
      }),
    ]);
    expect(descriptor.filterFamilyGaps).toEqual([
      {
        family: 'adjustment',
        implementedKinds: ['grayscale', 'invert', 'sepia'],
        missingPhotoshopFamilies: ['camera-raw', 'lens-correction', 'liquify', 'neural-filters'],
        warning: 'Adjustment-style layer filters are limited to grayscale, invert, and sepia; Camera Raw, Lens Correction, Liquify, and Neural Filters remain unsupported as editable filters.',
      },
      {
        family: 'geometry',
        implementedKinds: ['blur', 'pixelate', 'sharpen'],
        missingPhotoshopFamilies: ['adaptive-blur', 'field-blur', 'motion-blur', 'smart-sharpen'],
        warning: 'Geometry filters cover basic blur, sharpen, and pixelate only; adaptive blur, Field Blur, Motion Blur, and Smart Sharpen controls remain unsupported.',
      },
      {
        family: 'texture',
        implementedKinds: ['noise'],
        missingPhotoshopFamilies: ['add-grain', 'clouds', 'render-lighting', 'texture-gallery'],
        warning: 'Texture filters only expose deterministic noise; grain, clouds, lighting, and gallery textures remain unsupported.',
      },
      {
        family: 'photographic',
        implementedKinds: ['denoise'],
        missingPhotoshopFamilies: ['camera-raw', 'lens-correction', 'chromatic-aberration', 'defringe'],
        warning: 'Photographic correction provides a retained local impulse-noise reduction filter only; camera/lens profiles, chromatic aberration, defringe, RAW development, and learned denoise remain unsupported.',
      },
    ]);
    expect(descriptor.previewReadiness).toEqual({
      status: 'partial',
      liveCanvasPreview: true,
      stackSignature: descriptor.previewSignature,
      gaps: [
        'Smart-filter mask previews are not composited.',
        'Advanced per-filter parameter editors are not available.',
      ],
    });
    expect(descriptor.controlReadiness).toEqual({
      amount: true,
      blendMode: true,
      enabled: true,
      opacity: true,
      reorder: true,
      smartFilterMask: false,
      advancedParameters: false,
    });
    expect(descriptor.stackSignatures).toEqual({
      order: 'layer-filter-order:v1:[{"order":0,"kind":"blur","enabled":true},{"order":1,"kind":"noise","enabled":true}]',
      blend: 'layer-filter-blend:v1:[{"order":0,"kind":"blur","blendMode":"screen"},{"order":1,"kind":"noise","blendMode":"overlay"}]',
      opacity: 'layer-filter-opacity:v1:[{"order":0,"kind":"blur","opacity":0.75},{"order":1,"kind":"noise","opacity":0.4}]',
    });
    expect(descriptor.presetPortability).toEqual({
      status: 'blocked',
      signature: 'layer-filter-preset:v1:[{"order":0,"kind":"blur","enabled":true,"amount":4,"opacity":0.75,"blendMode":"screen"},{"order":1,"kind":"noise","enabled":true,"amount":18,"opacity":0.4,"blendMode":"overlay"}]',
      warnings: [
        'Preset export is blocked while per-filter alpha masks or unsupported filter parameters are required.',
      ],
    });
    expect(descriptor.exportFlattening).toEqual({
      target: 'flattened',
      willRasterize: true,
      warnings: [
        'Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.',
        'Per-filter alpha masks and advanced parameters bake into flattened output; native Smart Filter roundtrip is unsupported.',
      ],
    });
    expect(descriptor.nonDestructiveLimits).toEqual([
      'Editable stacks preserve order, amount, opacity, blend mode, enabled state, and owned per-filter alpha masks.',
      'Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.',
      'Unsupported filter parameters require rasterization or lossy preset omission.',
    ]);
    expect(descriptor.smartFilterStyleLimits).toEqual([
      {
        id: 'mask',
        editable: false,
        portability: 'metadata-only',
        warning: 'Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.',
      },
      {
        id: 'blend-mode',
        editable: true,
        portability: 'flattened-handoff',
        warning: 'Per-filter blend modes stay editable in Sloom Studio but flatten into preview/export pixels for native smart-filter handoff.',
      },
      {
        id: 'opacity',
        editable: true,
        portability: 'flattened-handoff',
        warning: 'Per-filter opacity stays editable in Sloom Studio metadata but is baked into flattened preview/export pixels.',
      },
      {
        id: 'order',
        editable: true,
        portability: 'flattened-handoff',
        warning: 'Per-filter order stays deterministic in Sloom Studio metadata but does not roundtrip as editable native smart-filter order.',
      },
    ]);
    expect(descriptor.portability).toEqual({
      portableWithinSignalLoom: false,
      portableAcrossSignalLoomDocuments: false,
      portableAsEditablePhotoshopSmartFilters: false,
      sourceBinVisibleExport: 'flattened-preview-plus-metadata',
      suiteVideoHandoff: 'flattened-visible-raster-plus-metadata',
      warnings: [
        'Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.',
        'Unsupported filter parameters require rasterization or lossy preset omission.',
        'Source Bin and Video handoff preserve flattened pixels plus Sloom Studio metadata only; editable native smart-filter roundtrip is unavailable.',
      ],
      signature:
        'layer-filter-portability:v1:{"portableWithinSignalLoom":false,"portableAcrossSignalLoomDocuments":false,"portableAsEditablePhotoshopSmartFilters":false,"sourceBinVisibleExport":"flattened-preview-plus-metadata","suiteVideoHandoff":"flattened-visible-raster-plus-metadata","warnings":["Smart-filter masks are metadata-only and cannot be edited or previewed non-destructively.","Unsupported filter parameters require rasterization or lossy preset omission.","Source Bin and Video handoff preserve flattened pixels plus Sloom Studio metadata only; editable native smart-filter roundtrip is unavailable."]}',
    });
  });

  it('summarizes editable filter stack readiness with supported filters and blocker codes', () => {
    const readiness = describeEditableFilterStackReadiness(makeFilters(
      { id: 'blur-runtime', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'screen' },
      { id: 'noise-runtime', kind: 'noise', enabled: true, amount: 18, opacity: 0.4, blendMode: 'overlay' },
    ), {
      sourceBounds: { x: 2, y: 3, width: 20, height: 10 },
      smartFilterMask: 'present',
      parameterTypesByFilterId: {
        'blur-runtime': ['amount', 'kernel'],
        'noise-runtime': ['amount', 'procedural'],
      },
      exportTarget: 'flattened',
    });

    expect(readiness.supportedFilters).toEqual([
      { kind: 'grayscale', family: 'adjustment', label: 'Grayscale', defaultAmount: 100 },
      { kind: 'invert', family: 'adjustment', label: 'Invert', defaultAmount: 100 },
      { kind: 'sepia', family: 'adjustment', label: 'Sepia', defaultAmount: 100 },
      { kind: 'blur', family: 'geometry', label: 'Blur', defaultAmount: 8 },
      { kind: 'pixelate', family: 'geometry', label: 'Pixelate', defaultAmount: 8 },
      { kind: 'sharpen', family: 'geometry', label: 'Sharpen', defaultAmount: 50 },
      { kind: 'noise', family: 'texture', label: 'Noise', defaultAmount: 25 },
      { kind: 'denoise', family: 'photographic', label: 'Reduce Noise', defaultAmount: 60 },
    ]);
    expect(readiness.stackControls).toEqual({
      reorder: true,
      opacity: true,
      blendMode: true,
      enabled: true,
      amount: true,
    });
    expect(readiness.paritySignatures).toEqual({
      preview: readiness.interop.previewSignature,
      export: readiness.interop.exportSignature,
      order: readiness.interop.stackSignatures.order,
      blend: readiness.interop.stackSignatures.blend,
      opacity: readiness.interop.stackSignatures.opacity,
    });
    expect(readiness.blockers).toEqual([
      {
        code: 'smart-filter-mask-unsupported',
        severity: 'blocking',
        message: 'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
      },
      {
        code: 'advanced-filter-parameters-unsupported',
        severity: 'blocking',
        message: 'Unsupported filter parameters require rasterization or lossy preset omission.',
      },
      {
        code: 'flattened-export-rasterizes-stack',
        severity: 'warning',
        message: 'Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.',
      },
    ]);
  });

  it('reports clean editable filter stack readiness without blockers for scalar filter stacks', () => {
    const readiness = describeEditableFilterStackReadiness(makeFilters(
      { id: 'gray-runtime', kind: 'grayscale', enabled: true, amount: 100, opacity: 1, blendMode: 'normal' },
    ), {
      sourceBounds: { x: 0, y: 0, width: 12, height: 12 },
    });

    expect(readiness.interop.previewReadiness.status).toBe('ready');
    expect(readiness.interop.presetPortability.status).toBe('portable');
    expect(readiness.interop.exportFlattening).toEqual({
      target: 'editable',
      willRasterize: false,
      warnings: [],
    });
    expect(readiness.blockers).toEqual([]);
  });

  it('describes layer filter action readiness for preview, commit, source-bin handoff, and batch replay', () => {
    const readiness = describeLayerFilterActionReadiness(makeFilters(
      { id: 'blur-runtime', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'screen' },
      { id: 'noise-runtime', kind: 'noise', enabled: false, amount: 18, opacity: 0.4, blendMode: 'overlay' },
    ), {
      sourceBounds: { x: 2, y: 3, width: 20, height: 10 },
      layer: {
        id: 'layer-1',
        name: 'Portrait',
        type: 'image',
        visible: true,
        locked: false,
        hasBitmap: true,
        sourceBinId: 'source-1',
      },
      visibleExportTarget: 'source-bin',
      batchMode: true,
    });

    expect(readiness.supportedStack.map((filter) => filter.kind)).toEqual([
      'grayscale',
      'invert',
      'sepia',
      'blur',
      'pixelate',
      'sharpen',
      'noise',
      'denoise',
    ]);
    expect(readiness.layerMetadata).toEqual({
      layerId: 'layer-1',
      layerName: 'Portrait',
      layerType: 'image',
      visible: true,
      locked: false,
      hasBitmap: true,
      sourceBinId: 'source-1',
      filterCount: 2,
      enabledFilterCount: 1,
      filterKinds: ['blur', 'noise'],
      sourceBinHandoff: {
        status: 'safe',
        visibleExportRequired: true,
        warnings: [],
      },
    });
    expect(readiness.semantics).toEqual({
      preview: 'non-destructive-live',
      commit: 'metadata-stack',
      preservesSourcePixels: true,
      mutatesPixelsOnCommit: false,
      previewSignature: readiness.interop.previewSignature,
      commitSignature: readiness.interop.exportSignature,
    });
    expect(readiness.unsupportedStates.map((state) => state.code)).toEqual([
      'filter-gallery-unsupported',
      'native-smart-filter-roundtrip-unsupported',
    ]);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.batchSuitability).toEqual({
      status: 'suitable',
      deterministic: true,
      actionRecordable: true,
      replayTarget: 'active-layer',
      signature:
        'layer-filter-batch:v1:{"layerType":"image","filterKinds":["blur","noise"],"enabledFilterCount":1,"blockers":[],"visibleExportTarget":"source-bin"}',
      warnings: [
        'Batch replay targets the active layer and preserves filter metadata only when the destination layer supports Image filter stacks.',
        'Source Bin handoff preserves flattened preview pixels plus metadata only; editable smart-filter order, blend mode, and opacity stay local to Image.',
      ],
    });
  });

  it('blocks invalid filter parameters and unsafe visible source-bin handoff states', () => {
    const readiness = describeLayerFilterActionReadiness(makeFilters(
      { id: 'blur-runtime', kind: 'blur', enabled: true, amount: Number.NaN, opacity: 1.2, blendMode: 'screen' },
    ), {
      smartFilterMask: 'present',
      parameterTypesByFilterId: {
        'blur-runtime': ['amount', 'kernel'],
      },
      layer: {
        id: 'layer-1',
        name: 'Hidden locked layer',
        type: 'image',
        visible: false,
        locked: true,
        hasBitmap: true,
      },
      galleryFilterRequested: 'Filter Gallery > Dry Brush',
      nativeSmartFilterRequested: true,
      visibleExportTarget: 'source-bin',
      batchMode: true,
    });

    expect(readiness.layerMetadata.sourceBinHandoff).toEqual({
      status: 'blocked',
      visibleExportRequired: true,
      warnings: [
        'Visible source-bin handoff is blocked because the layer is hidden.',
        'Visible source-bin handoff cannot preserve editable layer filter metadata; export a flattened preview plus source metadata.',
      ],
    });
    expect(readiness.blockers).toEqual([
      {
        code: 'layer-locked',
        severity: 'blocking',
        filterId: undefined,
        message: 'Layer filters cannot be committed while the target layer is locked.',
      },
      {
        code: 'invalid-filter-amount',
        severity: 'blocking',
        filterId: 'blur-runtime',
        message: 'Blur has an invalid amount; filter amounts must be finite numbers at or above 0.',
      },
      {
        code: 'invalid-filter-opacity',
        severity: 'blocking',
        filterId: 'blur-runtime',
        message: 'Blur has an invalid opacity; filter opacity must be between 0 and 1.',
      },
      {
        code: 'smart-filter-mask-unsupported',
        severity: 'blocking',
        filterId: undefined,
        message: 'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
      },
      {
        code: 'advanced-filter-parameters-unsupported',
        severity: 'blocking',
        filterId: undefined,
        message: 'Unsupported filter parameters require rasterization or lossy preset omission.',
      },
      {
        code: 'filter-gallery-unsupported',
        severity: 'blocking',
        filterId: undefined,
        message: 'Filter Gallery > Dry Brush is not available as an editable Image filter stack; use a supported filter or flatten externally.',
      },
      {
        code: 'native-smart-filter-roundtrip-unsupported',
        severity: 'blocking',
        filterId: undefined,
        message: 'Native Photoshop Smart Filters are metadata-only in Image and cannot roundtrip as editable native smart filters.',
      },
      {
        code: 'visible-source-bin-handoff-blocked',
        severity: 'blocking',
        filterId: undefined,
        message: 'Visible source-bin handoff is blocked because the layer is hidden.',
      },
    ]);
    expect(readiness.semantics.commit).toBe('blocked');
    expect(readiness.batchSuitability.status).toBe('blocked');
    expect(readiness.batchSuitability.actionRecordable).toBe(false);
  });

  it('creates enabled default layer filters', () => {
    expect(createDefaultLayerFilter('blur')).toMatchObject({
      kind: 'blur',
      enabled: true,
      amount: 8,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(createDefaultLayerFilter('grayscale')).toMatchObject({
      kind: 'grayscale',
      enabled: true,
      amount: 100,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(createDefaultLayerFilter('pixelate')).toMatchObject({
      kind: 'pixelate',
      enabled: true,
      amount: 8,
      opacity: 1,
      blendMode: 'normal',
    });
  });

  it('applies grayscale while preserving alpha', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [200, 10, 10, 128]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'gray',
      kind: 'grayscale',
      enabled: true,
      amount: 100,
      opacity: 1,
      blendMode: 'normal',
    }));

    expect(getPixel(filtered, 0, 0)).toEqual([50, 50, 50, 128]);
  });

  it('blends filter output with the source image using per-filter opacity', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [200, 10, 10, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'gray-half',
      kind: 'grayscale',
      enabled: true,
      amount: 100,
      opacity: 0.5,
      blendMode: 'normal',
    } as ImageLayerFilter));

    expect(getPixel(filtered, 0, 0)).toEqual([125, 30, 30, 255]);
  });

  it('applies filter blend modes when compositing filtered output back into the stack', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [200, 100, 50, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'gray-multiply',
      kind: 'grayscale',
      enabled: true,
      amount: 100,
      opacity: 1,
      blendMode: 'multiply',
    } as ImageLayerFilter));

    expect(getPixel(filtered, 0, 0)).toEqual([93, 46, 23, 255]);
  });

  it('applies box blur to neighboring pixels', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 0, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 0, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'blur',
      kind: 'blur',
      enabled: true,
      amount: 1,
      opacity: 1,
      blendMode: 'normal',
    }));

    expect(getPixel(filtered, 1, 0)).toEqual([85, 0, 0, 255]);
  });

  it('applies sepia and ignores disabled filters', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 100, 100, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters(
      { id: 'off', kind: 'invert', enabled: false, amount: 100, opacity: 1, blendMode: 'normal' },
      { id: 'sepia', kind: 'sepia', enabled: true, amount: 100, opacity: 1, blendMode: 'normal' },
    ));

    expect(getPixel(filtered, 0, 0)).toEqual([135, 120, 94, 255]);
  });

  it('applies pixelate by averaging pixels inside a block', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 0, 255, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'pixelate',
      kind: 'pixelate',
      enabled: true,
      amount: 2,
      opacity: 1,
      blendMode: 'normal',
    }));

    expect(getPixel(filtered, 0, 0)).toEqual([128, 0, 128, 255]);
    expect(getPixel(filtered, 1, 0)).toEqual([128, 0, 128, 255]);
  });

  it('applies deterministic noise while preserving alpha', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 100, 100, 200]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'noise',
      kind: 'noise',
      enabled: true,
      amount: 50,
      opacity: 1,
      blendMode: 'normal',
    }));

    expect(getPixel(filtered, 0, 0)).not.toEqual([100, 100, 100, 200]);
    expect(getPixel(filtered, 0, 0)[3]).toBe(200);
  });

  it('reduces an isolated impulse while retaining alpha', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [0, 0, 0, 255]);
    setPixel(imageData, 1, 0, [255, 255, 255, 123]);
    setPixel(imageData, 2, 0, [0, 0, 0, 255]);

    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'denoise', kind: 'denoise', enabled: true, amount: 100, opacity: 1, blendMode: 'normal',
    }));

    expect(getPixel(filtered, 1, 0)).toEqual([0, 0, 0, 123]);
  });

  it('applies each filter only where its owned mask has alpha', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [100, 40, 20, 255]);
    setPixel(imageData, 1, 0, [100, 40, 20, 255]);
    const mask = createLayerFilterMask(2, 1, 255);
    mask.alpha[1] = 0;
    const filtered = applyLayerFiltersToImageData(imageData, makeFilters({
      id: 'invert-masked', kind: 'invert', enabled: true, amount: 100, opacity: 1, blendMode: 'normal', mask,
    }));
    expect(getPixel(filtered, 0, 0)).toEqual([155, 215, 235, 255]);
    expect(getPixel(filtered, 1, 0)).toEqual([100, 40, 20, 255]);
  });

  it('keeps mask edits serializable and bounded to coverage', () => {
    const mask = createLayerFilterMask(2, 1, 255);
    const edited = setLayerFilterMaskCoverage(mask, 0.25);
    expect(edited).toEqual({ width: 2, height: 1, alpha: [64, 64] });
    expect(JSON.parse(JSON.stringify(edited))).toEqual(edited);
    expect(setLayerFilterMaskCoverage(mask, 2).alpha).toEqual([255, 255]);
  });

  it('retains an owned mask when a normal stack edit is applied', () => {
    const mask = createLayerFilterMask(1, 1, 0);
    const source = makeFilters({ id: 'masked', kind: 'blur', enabled: true, amount: 2, opacity: 1, blendMode: 'normal', mask });
    const result = applyLayerFilterStackEditOperation(source, { type: 'set-opacity', filterId: 'masked', opacity: 0.5 });
    expect(result.filters[0].mask).toEqual(mask);
    expect(result.filters[0].mask).not.toBe(mask);
  });
});
