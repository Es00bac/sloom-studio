import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import {
  describeImageLayerBlendModeReadiness,
  describeImageLayerSuiteHandoffReadiness,
  describeImageSmartSourceLinkedLayerMetadata,
  getImageLayerBlendModeReadinessCatalog,
  type ImageLayerBlendModeSupportDescriptor,
  type ImageLayerBlendModeSupportGroup,
  type ImageLayerBlendUnsupportedStateDescriptor,
} from './ImageLayerWorkflowMetadata';

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Linked Panel',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 12,
    y: 24,
    bitmap: { width: 640, height: 480 } as ImageLayer['bitmap'],
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Document',
    width: 1920,
    height: 1080,
    layers: [],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

describe('ImageLayerWorkflowMetadata smart source descriptors', () => {
  it('describes source-link status, history, warnings, and preview signatures deterministically', () => {
    const layer = makeLayer({
      id: 'linked-layer',
      name: 'Linked Panel',
      metadata: {
        smartLinkedSourceId: 'src-current',
        sourceLabel: 'Current Panel',
        sourceLink: {
          id: 'src-current',
          label: 'Current Panel',
          width: 2048,
          height: 1536,
          status: 'missing',
          relinkHistory: [
            { sourceId: 'src-original', label: 'Original Panel', at: 1710000000000 },
            { sourceId: 'src-current', label: 'Current Panel', at: 1710000200000 },
          ],
        },
      },
    });
    const doc = makeDoc({
      layers: [layer],
      snapshots: [
        {
          id: 'snap-before',
          name: 'Before relink',
          createdAt: 1710000100000,
          width: 1920,
          height: 1080,
          layers: [layer],
          activeLayerId: 'linked-layer',
          hasSelection: true,
          selectionVersion: 4,
        },
      ],
    });

    const first = describeImageSmartSourceLinkedLayerMetadata(layer, {
      doc,
      sourceExists: false,
      includePsdSmartObjectWarning: true,
      referenceSnapshotId: 'snap-before',
    });
    const second = describeImageSmartSourceLinkedLayerMetadata(layer, {
      doc,
      sourceExists: false,
      includePsdSmartObjectWarning: true,
      referenceSnapshotId: 'snap-before',
    });

    expect(first).toMatchObject({
      descriptorId: 'image-smart-source-linked-layer:v1',
      layerId: 'linked-layer',
      sourceId: 'src-current',
      label: 'Current Panel',
      status: {
        state: 'missing',
        linked: false,
        missing: true,
        relinked: false,
        repairRequired: true,
      },
      history: {
        relinkCount: 2,
        lastRelinkAt: 1710000200000,
        lastSourceId: 'src-current',
        entries: [
          { sourceId: 'src-original', label: 'Original Panel', at: 1710000000000 },
          { sourceId: 'src-current', label: 'Current Panel', at: 1710000200000 },
        ],
      },
      preview: {
        previewId: 'smart-source-preview:linked-layer:src-current:snap-before',
        layerBounds: { x: 12, y: 24, width: 640, height: 480 },
        sourceDimensions: { width: 2048, height: 1536 },
        referenceSnapshot: {
          snapshotId: 'snap-before',
          name: 'Before relink',
          layerCount: 1,
          activeLayerId: 'linked-layer',
          hasSelection: true,
          selectionVersion: 4,
        },
      },
    });
    expect(first.warnings.map((warning) => warning.code)).toEqual([
      'missing-source-asset',
      'repair-required',
      'metadata-only-psd-smart-object',
    ]);
    expect(first.psdSmartObject).toEqual({
      nativePsdSmartObject: false,
      metadataOnly: true,
      flattenedPixels: true,
    });
    expect(first.sourceSnapshotAvailability).toEqual({
      available: true,
      snapshotId: 'snap-before',
      sourceId: 'src-current',
      sourcePresentInSnapshot: true,
      state: 'available',
    });
    expect(first.externalAssetPackaging).toEqual({
      required: true,
      caveats: ['PSD Smart Object export is metadata-only; package the original Source Library asset beside flattened pixels for suite handoff.'],
    });
    expect(first.suiteHandoffBlockers).toEqual([
      {
        code: 'missing-source-asset',
        target: 'suite',
        message: 'Source Library asset "src-current" is unavailable for Flow, Video, or Paper handoff.',
      },
      {
        code: 'metadata-only-psd-smart-object',
        target: 'suite',
        message: 'Native PSD Smart Object data is not packaged; only metadata and flattened pixels are available.',
      },
    ]);
    expect(second).toEqual(first);
    expect(first.actionSuitability.replaceContents).toEqual({
      suitable: false,
      operation: 'replace-contents',
      warningCodes: ['missing-source-asset', 'repair-required'],
      caveats: ['Replace Contents is blocked until the layer has an available Source Library image asset.'],
    });
    expect(first.actionSuitability.relinkRepair).toEqual({
      suitable: true,
      operation: 'relink-repair',
      warningCodes: [],
      caveats: ['Relink repair can update metadata once the replacement Source Library asset is selected.'],
    });
    expect(first.batchSuitability).toEqual({
      suitable: false,
      operation: 'batch-replace-contents',
      warningCodes: ['missing-source-asset', 'repair-required'],
      caveats: ['Batch actions are blocked by missing source-link metadata or unavailable Source Library assets.'],
    });
    expect(first.previewSignature).toBe('image-smart-source-linked-layer:v1:{"layerId":"linked-layer","sourceId":"src-current","status":"missing","sourceExists":false,"relinkHistory":[{"at":1710000000000,"sourceId":"src-original"},{"at":1710000200000,"sourceId":"src-current"}],"snapshotId":"snap-before","warnings":["missing-source-asset","repair-required","metadata-only-psd-smart-object"],"batchSuitable":false}');
  });

  it('describes relink readiness, source snapshot preservation, smart-filter limits, and source roundtrip status', () => {
    const layer = makeLayer({
      id: 'smart-filter-layer',
      name: 'Smart Filter Placement',
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 6, opacity: 0.75, blendMode: 'normal' },
        { id: 'filter-pixelate', kind: 'pixelate', enabled: false, amount: 4, opacity: 1, blendMode: 'multiply' },
      ],
      metadata: {
        smartLinkedSourceId: 'source-image',
        sourceLabel: 'Source Image',
        sourceLink: {
          id: 'source-image',
          label: 'Source Image',
          width: 1280,
          height: 720,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const doc = makeDoc({
      layers: [layer],
      snapshots: [
        {
          id: 'snap-source',
          name: 'Source before filters',
          createdAt: 1710000300000,
          width: 1920,
          height: 1080,
          layers: [layer],
          activeLayerId: 'smart-filter-layer',
          hasSelection: false,
          selectionVersion: 0,
        },
      ],
    });

    const descriptor = describeImageSmartSourceLinkedLayerMetadata(layer, {
      doc,
      sourceExists: true,
      referenceSnapshotId: 'snap-source',
      includePsdSmartObjectWarning: true,
    });

    expect(descriptor.status).toMatchObject({
      relinkReadiness: 'ready',
      repairReadiness: 'not-needed',
    });
    expect(descriptor.operations).toEqual({
      editOriginal: {
        status: 'metadata-only',
        sourceId: 'source-image',
        preservesSourceSnapshot: true,
      },
      replaceContents: {
        status: 'ready',
        sourceId: 'source-image',
        preservesTransform: true,
      },
      rasterize: {
        status: 'ready',
        preservesSourceLink: false,
      },
    });
    expect(descriptor.sourceSnapshotPreservation).toEqual({
      preserved: true,
      snapshotId: 'snap-source',
      layerCount: 1,
      sourceIds: ['source-image'],
      missingSourceIds: [],
    });
    expect(descriptor.smartFilters).toEqual({
      filterCount: 2,
      enabledFilterCount: 1,
      editableStack: true,
      nativePsdSmartFilters: false,
      limitationWarnings: [
        {
          code: 'metadata-only-smart-filters',
          message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
        },
      ],
      previewSignature: 'image-smart-filter-stack:v1:[{"id":"filter-blur","kind":"blur","enabled":true,"amount":6,"opacity":0.75,"blendMode":"normal"},{"id":"filter-pixelate","kind":"pixelate","enabled":false,"amount":4,"opacity":1,"blendMode":"multiply"}]',
      exportSignature: 'layer-filter-export:v1:{"target":"flattened","filters":[{"order":0,"kind":"blur","enabled":true,"amount":6,"opacity":0.75,"blendMode":"normal","bounds":{"x":-6,"y":-6,"width":652,"height":492}},{"order":1,"kind":"pixelate","enabled":false,"amount":4,"opacity":1,"blendMode":"multiply","bounds":{"x":-6,"y":-6,"width":652,"height":492}}],"smartFilterMask":"absent","unsupportedParameters":[]}',
      stackSignatures: {
        order: 'layer-filter-order:v1:[{"order":0,"kind":"blur","enabled":true},{"order":1,"kind":"pixelate","enabled":false}]',
        blend: 'layer-filter-blend:v1:[{"order":0,"kind":"blur","blendMode":"normal"},{"order":1,"kind":"pixelate","blendMode":"multiply"}]',
        opacity: 'layer-filter-opacity:v1:[{"order":0,"kind":"blur","opacity":0.75},{"order":1,"kind":"pixelate","opacity":1}]',
      },
      handoffWarnings: [
        'Source Bin and Video handoff preserve flattened pixels plus Sloom Studio metadata only; editable native smart-filter roundtrip is unavailable.',
      ],
    });
    expect(descriptor.preview.previewId).toBe('smart-source-preview:smart-filter-layer:source-image:snap-source');
    expect(descriptor.sourceSnapshotAvailability).toEqual({
      available: true,
      snapshotId: 'snap-source',
      sourceId: 'source-image',
      sourcePresentInSnapshot: true,
      state: 'available',
    });
    expect(descriptor.externalAssetPackaging.required).toBe(true);
    expect(descriptor.externalAssetPackaging.caveats).toContain(
      'Smart Filter stacks are flattened for native PSD handoff; keep Sloom Studio metadata with the packaged source asset.',
    );
    expect(descriptor.suiteHandoffBlockers.map((blocker) => blocker.code)).toEqual([
      'metadata-only-psd-smart-object',
      'metadata-only-smart-filters',
    ]);
    expect(descriptor.sourceLinkRoundtrip).toEqual({
      canRoundtripMetadata: true,
      nativePsdSmartObject: false,
      metadataOnlyPsdSmartObject: true,
      sourceId: 'source-image',
      status: 'linked',
      relinkCount: 0,
      warningCodes: ['metadata-only-psd-smart-object'],
    });
    expect(descriptor.actionSuitability.replaceContents).toEqual({
      suitable: true,
      operation: 'replace-contents',
      warningCodes: [],
      caveats: [
        'Replace Contents can preserve transform, mask, layer effects, and source-link metadata.',
        'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
      ],
    });
    expect(descriptor.actionSuitability.editOriginal).toEqual({
      suitable: false,
      operation: 'edit-original',
      warningCodes: [],
      caveats: ['Edit Original is metadata-only; Sloom Studio does not launch or round-trip native external editors.'],
    });
    expect(descriptor.batchSuitability).toEqual({
      suitable: true,
      operation: 'batch-replace-contents',
      warningCodes: [],
      caveats: [
        'Batch actions are suitable for deterministic source-linked bitmap replacement when each layer resolves to a durable Source Library asset.',
        'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
      ],
    });
    expect(descriptor.previewSignature).toContain('"filterSignature":"image-smart-filter-stack:v1:');
    expect(descriptor.previewSignature).toContain('"batchSuitable":true');
  });

  it('keeps an owned filter mask editable locally while naming only the native PSD interchange limit', () => {
    const layer = makeLayer({
      id: 'local-filter-mask',
      filters: [{
        id: 'masked-blur',
        kind: 'blur',
        enabled: true,
        amount: 3,
        opacity: 1,
        blendMode: 'normal',
        mask: { width: 2, height: 1, alpha: [0, 255] },
      }],
      metadata: {
        smartLinkedSourceId: 'source-image',
        sourceLabel: 'Source image',
        sourceLink: { id: 'source-image', label: 'Source image', width: 640, height: 480, status: 'linked', relinkHistory: [] },
      },
    });

    const descriptor = describeImageSmartSourceLinkedLayerMetadata(layer, {
      doc: makeDoc({ layers: [layer] }),
      sourceExists: true,
    });

    expect(descriptor.smartFilters.exportSignature).toContain('"smartFilterMask":"local"');
    expect(descriptor.smartFilters.limitationWarnings).toContainEqual({
      code: 'smart-filter-mask-unsupported',
      message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
    });
    expect(descriptor.smartFilters.handoffWarnings).toContain(
      'Per-filter alpha masks stay editable in Sloom Studio and bake into flattened handoff pixels; native PSD Smart Filter masks are not written.',
    );
  });
});

describe('ImageLayerWorkflowMetadata blend mode readiness descriptors', () => {
  it('summarizes supported blend modes, canvas mappings, parity, caveats, and stable signatures', () => {
    const layer = makeLayer({
      id: 'blend-layer',
      name: 'Screen plate',
      opacity: 0.42,
      blendMode: 'screen',
    });

    const first = describeImageLayerBlendModeReadiness(layer, { exportTarget: 'flattened' });
    const second = describeImageLayerBlendModeReadiness(layer, { exportTarget: 'flattened' });

    expect(first).toMatchObject({
      descriptorId: 'image-layer-blend-readiness:v1',
      layerId: 'blend-layer',
      layerName: 'Screen plate',
      blendMode: 'screen',
      label: 'Screen',
      canvasCompositeOperation: 'screen',
      previewExportParity: {
        previewSupported: true,
        exportSupported: true,
        parity: 'canvas-flattened',
      },
      unsupported: {
        fillOpacity: {
          supported: false,
          requested: false,
          value: 1,
        },
        blendIf: {
          supported: false,
          requested: false,
        },
        channelTargeting: {
          supported: false,
          requested: false,
          channels: [],
        },
        knockout: {
          supported: false,
          requested: false,
          mode: 'none',
        },
      },
      alphaOpacityCaveats: [
        {
          id: 'layer-opacity',
          value: 0.42,
          caveat: 'Layer opacity uses Canvas globalAlpha before blend compositing; Photoshop fill opacity is not modeled.',
        },
        {
          id: 'flattened-alpha',
          value: 1,
          caveat: 'Flattened export preserves canvas alpha compositing but does not retain editable Photoshop blend stacks.',
        },
      ],
    });
    expect(first.supportedModes.map((mode: ImageLayerBlendModeSupportDescriptor) => mode.mode)).toEqual([
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
    ]);
    expect(first.supportedModes.find((mode: ImageLayerBlendModeSupportDescriptor) => mode.mode === 'normal')?.canvasCompositeOperation).toBe('source-over');
    expect(first.supportedModes.find((mode: ImageLayerBlendModeSupportDescriptor) => mode.mode === 'luminosity')?.canvasCompositeOperation).toBe('luminosity');
    expect(first.knownMathLimitations).toContain(
      'Canvas blend math is browser-managed and may not exactly match Photoshop in non-sRGB, high-bit-depth, or color-managed documents.',
    );
    expect(first.warningCodes).toEqual(['flattened-alpha']);
    expect(second).toEqual(first);
    expect(first.previewSignature).toBe('image-layer-blend-readiness-preview:v1:{"layerId":"blend-layer","blendMode":"screen","opacity":0.42,"unsupported":[],"exportTarget":"flattened"}');
    expect(first.exportSignature).toBe('image-layer-blend-readiness-export:v1:{"layerId":"blend-layer","blendMode":"screen","canvasCompositeOperation":"screen","exportTarget":"flattened","previewExportParity":"canvas-flattened","warningCodes":["flattened-alpha"]}');
  });

  it('marks Fill Opacity, Blend If, channel targeting, and knockout as unsupported requested states', () => {
    const descriptor = describeImageLayerBlendModeReadiness(makeLayer({
      id: 'advanced-blend-layer',
      name: 'Advanced Blend',
      blendMode: 'color-dodge',
    }), {
      fillOpacity: 0.35,
      blendIf: true,
      channelTargeting: ['blue', 'red', 'red'],
      knockout: 'deep',
    });

    expect(descriptor.unsupported).toEqual({
      fillOpacity: {
        supported: false,
        requested: true,
        value: 0.35,
        caveat: 'Photoshop Fill Opacity is unsupported; Sloom Studio applies only layer opacity for preview/export.',
      },
      blendIf: {
        supported: false,
        requested: true,
        caveat: 'Photoshop Blend If source/underlying tonal range splitting is unsupported and does not affect preview/export pixels.',
      },
      channelTargeting: {
        supported: false,
        requested: true,
        channels: ['blue', 'red'],
        caveat: 'Advanced blending channel targeting is unsupported; blend modes apply to the composited canvas result.',
      },
      knockout: {
        supported: false,
        requested: true,
        mode: 'deep',
        caveat: 'Photoshop shallow/deep knockout is unsupported; group/layer stacks are rendered without knockout isolation.',
      },
    });
    expect(descriptor.warningCodes).toEqual([
      'fill-opacity-unsupported',
      'blend-if-unsupported',
      'channel-targeting-unsupported',
      'knockout-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe('image-layer-blend-readiness-preview:v1:{"layerId":"advanced-blend-layer","blendMode":"color-dodge","opacity":1,"unsupported":["fill-opacity-unsupported","blend-if-unsupported","channel-targeting-unsupported","knockout-unsupported"],"exportTarget":"editable"}');
  });

  it('publishes typed blend portability checks and a stable descriptor signature', () => {
    const descriptor = describeImageLayerBlendModeReadiness(makeLayer({
      id: 'advanced-blend-layer',
      name: 'Advanced Blend',
      opacity: 0.73,
      blendMode: 'color-dodge',
    }), {
      exportTarget: 'flattened',
      fillOpacity: 0.35,
      blendIf: true,
      channelTargeting: ['blue', 'red', 'red'],
      knockout: 'deep',
    });

    expect(descriptor.portabilityChecks.map((check) => ({
      id: check.id,
      status: check.status,
      requested: check.requested,
      reasonCode: check.reasonCode,
    }))).toEqual([
      {
        id: 'fill-opacity',
        status: 'unsupported',
        requested: true,
        reasonCode: 'fill-opacity-unsupported',
      },
      {
        id: 'blend-if',
        status: 'unsupported',
        requested: true,
        reasonCode: 'blend-if-unsupported',
      },
      {
        id: 'channel-targeting',
        status: 'unsupported',
        requested: true,
        reasonCode: 'channel-targeting-unsupported',
      },
      {
        id: 'knockout',
        status: 'unsupported',
        requested: true,
        reasonCode: 'knockout-unsupported',
      },
      {
        id: 'flattened-alpha',
        status: 'warning',
        requested: true,
        reasonCode: 'flattened-alpha',
      },
    ]);
    expect(descriptor.portabilityChecks[0].signature).toBe('image-layer-blend-check:v1:{"layerId":"advanced-blend-layer","id":"fill-opacity","status":"unsupported","requested":true,"value":0.35}');
    expect(descriptor.signature).toBe('image-layer-blend-readiness:v1:{"layerId":"advanced-blend-layer","blendMode":"color-dodge","opacity":0.73,"exportTarget":"flattened","unsupported":{"fillOpacity":0.35,"blendIf":true,"channelTargeting":["blue","red"],"knockout":"deep"},"warningCodes":["fill-opacity-unsupported","blend-if-unsupported","channel-targeting-unsupported","knockout-unsupported","flattened-alpha"]}');
  });

  it('returns a deterministic blend readiness catalog for planning surfaces', () => {
    const catalog = getImageLayerBlendModeReadinessCatalog();

    expect(catalog.descriptorId).toBe('image-layer-blend-readiness-catalog:v1');
    expect(catalog.supportedModes).toHaveLength(16);
    expect(catalog.supportGroups.map((group: ImageLayerBlendModeSupportGroup) => group.id)).toEqual(['basic', 'contrast', 'component']);
    expect(catalog.unsupportedAdvancedStates.map((state: ImageLayerBlendUnsupportedStateDescriptor) => state.id)).toEqual([
      'fill-opacity',
      'blend-if',
      'channel-targeting',
      'knockout',
    ]);
    expect(catalog.signature).toBe('image-layer-blend-readiness-catalog:v1:{"modes":["normal","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"],"unsupported":["fill-opacity","blend-if","channel-targeting","knockout"],"groups":["basic","contrast","component"]}');
  });
});

describe('ImageLayerWorkflowMetadata suite handoff readiness descriptors', () => {
  it('summarizes visible/mask export, source packaging, target readiness, and stable signatures', () => {
    const sourceLayer = makeLayer({
      id: 'src-layer',
      name: 'Generated hero',
      blendMode: 'overlay',
      mask: { width: 320, height: 200 } as ImageLayer['mask'],
      metadata: {
        smartLinkedSourceId: 'source-generated',
        sourceLabel: 'Hero source',
        sourceLink: {
          id: 'source-generated',
          label: 'Hero source',
          width: 1280,
          height: 720,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const hiddenLayer = makeLayer({
      id: 'hidden-reference-layer',
      name: 'Hidden reference',
      visible: false,
      metadata: {
        smartLinkedSourceId: 'reference-plate',
        sourceLabel: 'Reference plate',
      },
    });
    const doc = makeDoc({
      id: 'suite-doc',
      title: 'Suite handoff',
      layers: [sourceLayer, hiddenLayer],
      sourceBinItemId: 'source-generated',
    });

    const first = describeImageLayerSuiteHandoffReadiness(doc, {
      sourceAssets: [
        {
          id: 'source-generated',
          label: 'Hero source',
          kind: 'image',
          mimeType: 'image/png',
          assetId: 'asset-hero',
          pixelWidth: 1280,
          pixelHeight: 720,
          isGenerated: true,
          originNodeId: 'image-node-1',
        },
        {
          id: 'reference-plate',
          label: 'Reference plate',
          kind: 'image',
          mimeType: 'image/jpeg',
          assetUrl: 'blob:http://localhost/reference',
          pixelWidth: 640,
          pixelHeight: 480,
        },
      ],
      includePsdSmartObjectWarning: true,
    });
    const second = describeImageLayerSuiteHandoffReadiness(doc, {
      sourceAssets: [
        {
          id: 'reference-plate',
          label: 'Reference plate',
          kind: 'image',
          mimeType: 'image/jpeg',
          assetUrl: 'blob:http://localhost/reference',
          pixelWidth: 640,
          pixelHeight: 480,
        },
        {
          id: 'source-generated',
          label: 'Hero source',
          kind: 'image',
          mimeType: 'image/png',
          assetId: 'asset-hero',
          pixelWidth: 1280,
          pixelHeight: 720,
          isGenerated: true,
          originNodeId: 'image-node-1',
        },
      ],
      includePsdSmartObjectWarning: true,
    });

    expect(first).toMatchObject({
      descriptorId: 'image-layer-suite-handoff-readiness:v1',
      documentId: 'suite-doc',
      documentTitle: 'Suite handoff',
      visibleExport: {
        format: 'flattened-visible-raster',
        layerIds: ['src-layer'],
        hiddenLayerIds: ['hidden-reference-layer'],
        maskLayerIds: ['src-layer'],
        hasMasks: true,
        maskExport: {
          supported: true,
          format: 'alpha-masked-visible-raster',
          caveats: ['Layer masks are flattened into exported visible pixels; editable masks stay in Sloom Studio metadata.'],
        },
      },
      sourceAssetPackaging: {
        required: true,
        requiredSourceIds: ['reference-plate', 'source-generated'],
        packagedSourceIds: ['source-generated'],
        missingSourceIds: [],
        blobOnlySourceIds: ['reference-plate'],
      },
      generatedSummary: {
        count: 1,
        sourceIds: ['source-generated'],
        originNodeIds: ['image-node-1'],
      },
      referenceSummary: {
        count: 1,
        sourceIds: ['reference-plate'],
      },
      sourceLinkedSummary: {
        count: 2,
        layerIds: ['hidden-reference-layer', 'src-layer'],
        sourceIds: ['reference-plate', 'source-generated'],
        missingSourceIds: [],
      },
    });
    expect(first.sourceAssetPackaging.warnings.map((warning: { code: string }) => warning.code)).toEqual([
      'blob-only-source-asset',
      'external-asset-packaging-required',
      'metadata-only-psd-smart-object',
    ]);
    expect(first.targets).toEqual({
      flow: {
        target: 'flow',
        status: 'warning',
        sendAction: 'send-to-flow-source-library',
        sourceIds: ['reference-plate', 'source-generated'],
        blockers: [],
        warnings: ['blob-only-source-asset', 'external-asset-packaging-required', 'metadata-only-psd-smart-object'],
        caveats: [
          'Flow handoff packages Source Library assets beside the flattened visible export when available.',
        ],
      },
      video: {
        target: 'video',
        status: 'warning',
        sendAction: 'send-to-video-source-library',
        sourceIds: ['reference-plate', 'source-generated'],
        blockers: [],
        warnings: ['blob-only-source-asset', 'external-asset-packaging-required', 'metadata-only-psd-smart-object'],
        caveats: [
          'Video handoff receives flattened visible pixels plus packaged sources; editable layer filter and effect stacks remain metadata-only.',
        ],
      },
      paper: {
        target: 'paper',
        status: 'warning',
        sendAction: 'send-to-paper-source-library',
        sourceIds: ['reference-plate', 'source-generated'],
        blockers: [],
        warnings: ['blob-only-source-asset', 'external-asset-packaging-required', 'metadata-only-psd-smart-object'],
        caveats: [
          'Paper handoff packages Source Library assets beside the flattened visible export when available.',
        ],
      },
    });
    expect(first.blendReadiness).toEqual([
      {
        layerId: 'src-layer',
        blendMode: 'overlay',
        previewSignature: 'image-layer-blend-readiness-preview:v1:{"layerId":"src-layer","blendMode":"overlay","opacity":1,"unsupported":[],"exportTarget":"flattened"}',
        exportSignature: 'image-layer-blend-readiness-export:v1:{"layerId":"src-layer","blendMode":"overlay","canvasCompositeOperation":"overlay","exportTarget":"flattened","previewExportParity":"canvas-flattened","warningCodes":["flattened-alpha"]}',
        warningCodes: ['flattened-alpha'],
      },
    ]);
    expect(second).toEqual(first);
    expect(first.previewSignature).toBe('image-layer-suite-handoff-readiness:v1:{"documentId":"suite-doc","visibleLayerIds":["src-layer"],"maskLayerIds":["src-layer"],"sourceIds":["reference-plate","source-generated"],"missingSourceIds":[],"blobOnlySourceIds":["reference-plate"],"targetStatuses":{"flow":"warning","video":"warning","paper":"warning"},"blendSignatures":["image-layer-blend-readiness-preview:v1:{\\"layerId\\":\\"src-layer\\",\\"blendMode\\":\\"overlay\\",\\"opacity\\":1,\\"unsupported\\":[],\\"exportTarget\\":\\"flattened\\"}"]}');
  });

  it('blocks suite targets when source-linked layers do not have durable source ids', () => {
    const orphanLayer = makeLayer({
      id: 'orphan-source-layer',
      name: 'Orphan source placement',
      metadata: {
        sourceLabel: 'Dropped reference',
      },
    });
    const doc = makeDoc({
      id: 'orphan-doc',
      layers: [orphanLayer],
    });

    const descriptor = describeImageLayerSuiteHandoffReadiness(doc);

    expect(descriptor.sourceAssetPackaging).toMatchObject({
      required: false,
      requiredSourceIds: [],
      packagedSourceIds: [],
      missingSourceIds: [],
      blobOnlySourceIds: [],
    });
    expect(descriptor.sourceLinkedSummary).toEqual({
      count: 1,
      layerIds: ['orphan-source-layer'],
      sourceIds: [],
      missingSourceIds: ['orphan-source-layer'],
    });
    expect(descriptor.missingSourceIdBlockers).toEqual([
      {
        code: 'missing-source-id',
        target: 'suite',
        layerId: 'orphan-source-layer',
        message: 'Layer "Orphan source placement" needs a durable Source Library id before Send to Flow, Video, or Paper.',
      },
    ]);
    expect(descriptor.targets.flow.status).toBe('blocked');
    expect(descriptor.targets.video.blockers).toEqual(['missing-source-id']);
    expect(descriptor.targets.paper.blockers).toEqual(['missing-source-id']);
    expect(descriptor.previewSignature).toBe('image-layer-suite-handoff-readiness:v1:{"documentId":"orphan-doc","visibleLayerIds":["orphan-source-layer"],"maskLayerIds":[],"sourceIds":[],"missingSourceIds":["orphan-source-layer"],"blobOnlySourceIds":[],"targetStatuses":{"flow":"blocked","video":"blocked","paper":"blocked"},"blendSignatures":["image-layer-blend-readiness-preview:v1:{\\"layerId\\":\\"orphan-source-layer\\",\\"blendMode\\":\\"normal\\",\\"opacity\\":1,\\"unsupported\\":[],\\"exportTarget\\":\\"flattened\\"}"]}');
  });
});
