import { describe, expect, it } from 'vitest';
import {
  applyImageLayerStylePreset,
  copyImageLayerStyle,
  createImageLayerStylePreset,
  describeImageLayerStylePortability,
  describeImageLayerStyleClipboardReadiness,
  describeImageLayerStyleSignatureSet,
  pasteImageLayerStyle,
} from './ImageLayerStyleClipboard';
import type { ImageLayer } from '../../types/imageEditor';

function layer(id: string): ImageLayer {
  return {
    id,
    name: id,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 0.5,
    blendMode: 'multiply',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    effects: [{ id: 'fx-1', kind: 'outerGlow', enabled: true, color: '#00ffff', opacity: 0.8, size: 20 }],
    filters: [{ id: 'filter-1', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal' }],
  };
}

describe('ImageLayerStyleClipboard', () => {
  it('copies layer style settings and pastes cloned values onto another layer', () => {
    const source = layer('source');
    const target = { ...layer('target'), effects: [], filters: [], opacity: 1, blendMode: 'normal' as const };

    const clipboard = copyImageLayerStyle(source);
    const pasted = pasteImageLayerStyle(target, clipboard);

    expect(clipboard.metadata?.blendMode).toEqual({
      mode: 'multiply',
      label: 'Multiply',
      previewSupported: true,
      exportSupported: true,
      previewCompositeOperation: 'multiply',
      exportCompositeOperation: 'multiply',
      warnings: [],
    });
    expect(pasted).toMatchObject({
      id: 'target',
      opacity: 0.5,
      blendMode: 'multiply',
    });
    expect(pasted.effects).toEqual(source.effects);
    expect(pasted.filters).toEqual(source.filters);
    expect(pasted.effects).not.toBe(source.effects);
    expect(pasted.filters).not.toBe(source.filters);
  });

  it('creates and applies reusable layer style presets without sharing effect references', () => {
    const source = layer('source');
    const target = { ...layer('target'), effects: [], filters: [], opacity: 1, blendMode: 'normal' as const };

    const preset = createImageLayerStylePreset('  Neon title  ', source, ['layer-style-neon-title']);
    const applied = applyImageLayerStylePreset(target, preset);

    expect(preset).toMatchObject({
      id: 'layer-style-neon-title-2',
      label: 'Neon title',
      style: {
        opacity: 0.5,
        blendMode: 'multiply',
        metadata: {
          blendMode: {
            label: 'Multiply',
            mode: 'multiply',
          },
        },
      },
    });
    expect(applied).toMatchObject({
      id: 'target',
      opacity: 0.5,
      blendMode: 'multiply',
    });
    expect(applied.effects).toEqual(source.effects);
    expect(applied.filters).toEqual(source.filters);
    expect(applied.effects).not.toBe(source.effects);
    expect(applied.filters).not.toBe(source.filters);
  });

  it('describes style preset portability across effects, filters, blend mode, and flattened export', () => {
    const source = {
      ...layer('source'),
      effects: [
        { id: 'fx-1', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 120, distance: 8, size: 6 },
        { id: 'fx-satin', kind: 'satin', enabled: true, color: '#000000', opacity: 0.45, angle: 19, distance: 10, size: 12, invert: false },
        { id: 'fx-pattern', kind: 'patternOverlay', enabled: true, color: '#ffffff', backgroundColor: '#000000', opacity: 0.35, pattern: 'checker', scale: 8 },
      ],
      filters: [
        { id: 'filter-1', kind: 'blur', enabled: true, amount: 3, opacity: 0.8, blendMode: 'multiply' },
      ],
    } as ImageLayer;

    const descriptor = describeImageLayerStylePortability(source, {
      unsupportedEffectKinds: ['patternOverlay', 'bevelEmboss'],
      blendIf: 'present',
      smartFilterMask: 'present',
      exportTarget: 'flattened',
    });

    expect(descriptor.portable).toBe(false);
    expect(descriptor.styleSignature).toContain('"previewId":"image-layer-style-portability:v2"');
    expect(descriptor.styleSignature).toContain('"blendMode":"multiply"');
    expect(descriptor.styleSignature).toContain('\\"target\\":\\"flattened\\"');
    expect(descriptor.styleSignature).toContain('\\"unsupported\\":[\\"bevelEmboss\\"]');
    expect(descriptor.styleSignature).toContain('\\"kind\\":\\"satin\\"');
    expect(descriptor.styleSignature).toContain('\\"kind\\":\\"patternOverlay\\"');
    expect(descriptor.styleSignature).toContain('\\"smartFilterMask\\":\\"present\\"');
    expect(descriptor.previewExportParity).toEqual({
      previewId: 'image-layer-style-preview-export:v1',
      previewSignature: expect.stringContaining('layer-effect-preview:v1'),
      exportSignature: expect.stringContaining('layer-effect-export:v1'),
      parity: 'rasterized-export',
    });
    expect(descriptor.warnings).toEqual([
      'Layer effects are rasterized into flattened exports; editable Photoshop layer-style roundtrip is not preserved.',
      'Bevel & Emboss is not supported yet; preserve it as metadata-only or flatten it before import/export.',
      'Photoshop Blend If / advanced blending options are not supported yet; flatten or rasterize them before relying on Image preview/export parity.',
      'Layer filter stacks are rasterized into flattened exports; editable smart-filter roundtrip is not preserved.',
      'Smart-filter masks are not supported yet; preserve the mask as metadata-only or rasterize it before applying Image filters.',
    ]);
  });

  it('publishes deterministic style preset portability metadata with preview IDs', () => {
    const source = {
      ...layer('source'),
      opacity: 1.4,
      effects: [
        { id: 'fx-1', kind: 'innerShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 80, distance: 8, size: 6 },
      ],
      filters: [],
    } as ImageLayer;

    const descriptor = describeImageLayerStylePortability(source, {
      unsupportedEffectKinds: ['bevelEmboss'],
      blendIf: 'present',
      exportTarget: 'editable',
    });

    expect(descriptor.previewId).toBe('image-layer-style-portability:v2');
    expect(descriptor.presetPortability).toEqual({
      id: 'image-layer-style-preset-portability:v1',
      portable: false,
      portableAcrossDocuments: false,
      opacity: 1,
      effectPreviewId: 'image-layer-effects-stack:v2',
      filterPreviewId: 'image-layer-filters-stack:v1',
      effectPresetPortability: {
        id: 'layer-effect-preset-portability:v1',
        portableWithinSignalLoom: false,
        portableAcrossDocuments: false,
        portableAsEditablePhotoshopLayerStyle: false,
        usesGlobalLight: true,
        unsupportedFeatures: ['blend-if', 'bevelEmboss'],
        warnings: [
          'Bevel & Emboss is not supported yet; preserve it as metadata-only or flatten it before import/export.',
          'Photoshop Blend If / advanced blending options are not supported yet; flatten or rasterize them before relying on Image preview/export parity.',
        ],
        signature: 'layer-effect-preset-portability:v1:blend-if|bevelEmboss:global-light:80:fx-1',
      },
      warnings: [
        'Bevel & Emboss is not supported yet; preserve it as metadata-only or flatten it before import/export.',
        'Photoshop Blend If / advanced blending options are not supported yet; flatten or rasterize them before relying on Image preview/export parity.',
      ],
    });
    expect(descriptor.previewExportParity.previewId).toBe('image-layer-style-preview-export:v1');
    expect(descriptor.previewExportParity.parity).toBe('unsupported');
    expect(descriptor.presetPortability.effectPresetPortability).toEqual({
      id: 'layer-effect-preset-portability:v1',
      portableWithinSignalLoom: false,
      portableAcrossDocuments: false,
      portableAsEditablePhotoshopLayerStyle: false,
      usesGlobalLight: true,
      unsupportedFeatures: ['blend-if', 'bevelEmboss'],
      warnings: [
        'Bevel & Emboss is not supported yet; preserve it as metadata-only or flatten it before import/export.',
        'Photoshop Blend If / advanced blending options are not supported yet; flatten or rasterize them before relying on Image preview/export parity.',
      ],
      signature: 'layer-effect-preset-portability:v1:blend-if|bevelEmboss:global-light:80:fx-1',
    });
    expect(descriptor.styleSignature).toContain('"previewId":"image-layer-style-portability:v2"');
  });

  it('describes style clipboard portability with blend caveats, source-bin parity, and batch suitability', () => {
    const descriptor = describeImageLayerStyleClipboardReadiness(layer('source'), {
      blendIf: 'present',
      fillOpacity: 0.6,
      knockout: 'shallow',
      channelTargeting: ['green'],
      exportTarget: 'source-bin',
      sourceBinLinked: false,
      batchLayerCount: 2,
    });

    expect(descriptor.id).toBe('image-layer-style-clipboard-readiness:v1');
    expect(descriptor.clipboardPortability).toEqual({
      canCopyPasteWithinDocument: true,
      canSaveAsSignalLoomPreset: false,
      canRoundTripAsEditablePhotoshopStyle: false,
      reasonCodes: [
        'blend-if-unsupported',
        'fill-opacity-unsupported',
        'knockout-unsupported',
        'channel-targeting-unsupported',
      ],
    });
    expect(descriptor.blendModeReadiness.unsupportedPhotoshopAdvancedStates).toEqual([
      expect.objectContaining({ id: 'blend-if', requested: true }),
      expect.objectContaining({ id: 'fill-opacity', requested: true, value: 0.6 }),
      expect.objectContaining({ id: 'knockout', requested: true, mode: 'shallow' }),
      expect.objectContaining({ id: 'channel-targeting', requested: true, channels: ['green'] }),
    ]);
    expect(descriptor.exportSourceBinParityCaveats).toEqual([
      expect.objectContaining({ code: 'source-bin-visible-export-flattens-blend-stack' }),
      expect.objectContaining({ code: 'source-bin-overwrite-needs-linked-source' }),
    ]);
    expect(descriptor.actionSuitability.recordable).toBe(false);
    expect(descriptor.batchSuitability).toEqual({
      status: 'blocked',
      layerCount: 2,
      reasonCodes: ['advanced-blending-unsupported', 'source-bin-unlinked-visible-export'],
    });
    expect(descriptor.clipboardSuitability).toEqual({
      copyPaste: {
        status: 'warning',
        summary: 'Copy/paste keeps the layer style inside Sloom Studio, but unsupported advanced blending stays metadata-only.',
        reasonCodes: [
          'blend-if-unsupported',
          'fill-opacity-unsupported',
          'knockout-unsupported',
          'channel-targeting-unsupported',
        ],
      },
      signalLoomPreset: {
        status: 'blocked',
        summary: 'Sloom Studio presets cannot preserve unsupported advanced blending or non-portable style warnings.',
        reasonCodes: [
          'blend-if-unsupported',
          'fill-opacity-unsupported',
          'knockout-unsupported',
          'channel-targeting-unsupported',
        ],
      },
      batchApplication: {
        status: 'blocked',
        summary: 'Batch application is blocked by unsupported advanced blending and unlinked Source Bin export requirements.',
        reasonCodes: ['advanced-blending-unsupported', 'source-bin-unlinked-visible-export'],
      },
    });
    expect(descriptor.signature).toContain('"layerId":"source"');
  });

  it('builds stable style set, clipboard, preset, and preview/export risk signatures', () => {
    const source = {
      ...layer('source'),
      effects: [
        { id: 'drop', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 30, distance: 8, size: 4 },
      ],
      filters: [],
    } as ImageLayer;

    const signatures = describeImageLayerStyleSignatureSet(source, {
      blendIf: 'present',
      fillOpacity: 0.5,
      unsupportedEffectKinds: ['bevelEmboss'],
      exportTarget: 'flattened',
    });

    expect(signatures.id).toBe('image-layer-style-signatures:v1');
    expect(signatures.styleSetSignature).toContain('"layerId":"source"');
    expect(signatures.styleSetSignature).toContain('"effectKinds":["dropShadow"]');
    expect(signatures.clipboardSignature).toContain('image-layer-style-clipboard:v1:');
    expect(signatures.presetSignature).toContain('image-layer-style-preset:v1:');
    expect(signatures.previewRiskSignature).toContain('"unsupportedStates":["effect-kind:bevelEmboss","blend-if","native-psd-live-effect-fidelity","smart-object-effect-preservation"]');
    expect(signatures.exportRiskSignature).toContain('"target":"flattened"');
    expect(signatures.unsupportedStateSignature).toBe(
      'image-layer-style-unsupported-states:v1:effect-kind:bevelEmboss|blend-if|native-psd-live-effect-fidelity|smart-object-effect-preservation',
    );
    expect(signatures.riskLevel).toBe('blocked');
    expect(signatures.unsupportedStates.map((state) => state.reasonCode)).toEqual([
      'layer-effect-bevel-emboss-unsupported',
      'layer-effect-blend-if-unsupported',
      'native-psd-live-effect-fidelity-unsupported',
      'smart-object-effect-preservation-unsupported',
    ]);
  });

  it('carries effect and filter portability warnings into preset and clipboard suitability checks', () => {
    const source = {
      ...layer('source'),
      effects: [
        {
          id: 'drop-runtime',
          kind: 'dropShadow',
          enabled: true,
          color: '#000000',
          opacity: 0.5,
          angle: 45,
          distance: 12,
          size: 8,
        },
      ],
      filters: [
        { id: 'filter-1', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal' },
      ],
    } as ImageLayer;

    const descriptor = describeImageLayerStyleClipboardReadiness(source, {
      unsupportedEffectKinds: ['bevelEmboss'],
      smartFilterMask: 'present',
      exportTarget: 'flattened',
    });

    expect(descriptor.clipboardPortability).toEqual({
      canCopyPasteWithinDocument: true,
      canSaveAsSignalLoomPreset: false,
      canRoundTripAsEditablePhotoshopStyle: false,
      reasonCodes: [
        'effect-portability-warning',
        'filter-portability-warning',
      ],
    });
    expect(descriptor.stylePortabilityChecks.map((check) => ({
      id: check.id,
      status: check.status,
      reasonCodes: check.reasonCodes,
    }))).toEqual([
      {
        id: 'blend-mode',
        status: 'ready',
        reasonCodes: [],
      },
      {
        id: 'effects',
        status: 'blocked',
        reasonCodes: [
          'effect-flattened-export',
          'effect-unsupported-metadata',
        ],
      },
      {
        id: 'global-light',
        status: 'warning',
        reasonCodes: ['global-light-native-style-roundtrip-unavailable'],
      },
      {
        id: 'filters',
        status: 'blocked',
        reasonCodes: [
          'filter-flattened-export',
          'smart-filter-mask-unsupported',
        ],
      },
    ]);
    expect(descriptor.clipboardSuitability.copyPaste).toEqual({
      status: 'ready',
      summary: 'Copy/paste keeps the layer style portable inside Sloom Studio.',
      reasonCodes: [],
    });
    expect(descriptor.clipboardSuitability.signalLoomPreset).toEqual({
      status: 'blocked',
      summary: 'Sloom Studio presets cannot preserve unsupported advanced blending or non-portable style warnings.',
      reasonCodes: [
        'effect-portability-warning',
        'filter-portability-warning',
      ],
    });
    expect(descriptor.signature).toContain('"styleChecks":["image-layer-style-check:v1:');
  });
});
