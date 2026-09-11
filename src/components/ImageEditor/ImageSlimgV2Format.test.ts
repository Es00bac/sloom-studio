import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import haneV1Golden from '../../lib/fixtures/slimg-v1-hane-golden.json';
import haneV2Golden from '../../lib/fixtures/slimg-v2-hane-golden.json';
import {
  sha256Hex,
  type SlimgV2AssetRecord,
  type SlimgV2Manifest,
} from '../../lib/slimgV2';
import { packContainer, unpackContainer, type ContainerManifest } from '../../shared/files/SignalLoomContainer';
import type { ImageDocument, LayerBitmap } from '../../types/imageEditor';
import { deleteImageLayerComp, renameImageLayerComp } from './ImageLayerComps';
import type { SlimgCodec } from './ImageSlimgFormat';
import {
  deserializeSlimgAnyVersion,
  serializeSlimgV1Compatibility,
  serializeSlimgV2,
} from './ImageSlimgV2Format';
import { applyAdjustmentToImageData } from './ImageAdjustmentLayer';
import { buildVectorPathLayer } from './ImageVectorShape';
import {
  clearAllImageSlimgRuntimeStatesForTests,
  getImageSlimgRuntimeState,
} from './ImageSlimgRuntimeState';
import { replaceSmartObjectFilterStack } from './smartObjects/SmartFilters';
import { createImageCmykPixelBuffer } from './cmyk/ImageCmykDocument';

class TestOffscreenCanvas {
  width: number;
  height: number;
  __tag: string;
  #bytes: Uint8ClampedArray;

  constructor(width: number, height: number, tag = '') {
    this.width = width;
    this.height = height;
    this.__tag = tag;
    const tagBytes = new TextEncoder().encode(tag);
    this.#bytes = new Uint8ClampedArray(
      Array.from(
        { length: width * height * 4 },
        (_, index) => tagBytes.length > 0 ? tagBytes[index % tagBytes.length] : 0,
      ),
    );
  }

  getContext() {
    return {
      save: () => {},
      restore: () => {},
      translate: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      fill: () => {},
      stroke: () => {},
      drawImage: (source: LayerBitmap) => {
        const context = source.getContext('2d');
        if (!context) throw new Error('test bitmap source has no readable context');
        this.#bytes = new Uint8ClampedArray(
          context.getImageData(0, 0, source.width, source.height).data,
        );
      },
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.#bytes),
      }),
      putImageData: (imageData: ImageData) => {
        this.#bytes = new Uint8ClampedArray(imageData.data);
      },
      clearRect: () => {
        this.#bytes.fill(0);
      },
    };
  }

  async convertToBlob(): Promise<Blob> {
    return new Blob([this.#bytes.buffer as ArrayBuffer]);
  }
}

function bitmap(width: number, height: number, tag: string): LayerBitmap {
  return new TestOffscreenCanvas(width, height, tag) as unknown as LayerBitmap;
}

const codec: SlimgCodec = {
  encode: async (source) => new TextEncoder().encode(
    (source as unknown as { __tag: string }).__tag,
  ),
  decode: async (bytes, width, height) => bitmap(
    width,
    height,
    new TextDecoder().decode(bytes),
  ),
};

function documentFixture(): ImageDocument {
  return {
    id: 'sloom-v2-doc',
    title: 'Sloom v2',
    width: 64,
    height: 48,
    activeLayerId: 'vector',
    layers: [
      {
        id: 'paint',
        name: 'Paint',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: bitmap(64, 48, 'PAINT'),
        bitmapVersion: 3,
        mask: null,
      },
      {
        id: 'vector',
        name: 'Editable shape',
        type: 'vector',
        visible: true,
        locked: false,
        opacity: 0.8,
        blendMode: 'multiply',
        x: 3,
        y: 4,
        rotationDeg: 12,
        skewXDeg: 4,
        bitmap: bitmap(64, 48, 'VECTOR-FALLBACK'),
        bitmapVersion: 1,
        mask: null,
        vectorRecipe: '<svg viewBox="0 0 64 48"><path d="M0 0H20V20Z"/></svg>',
      },
    ],
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    guides: [{ id: 'guide-x', axis: 'x', position: 12 }],
    dirty: true,
    snapshots: [],
  };
}

function haneArchive(manifest: unknown, pixels = 'pixels'): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'assets/pixels.png': new TextEncoder().encode(pixels),
  });
}

function assetRecord(
  id: string,
  bytes: Uint8Array,
  role: SlimgV2AssetRecord['role'],
  mimeType: string,
): SlimgV2AssetRecord {
  return {
    id,
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    role,
    mimeType,
  };
}

function nativeConstructArchive(): {
  bytes: Uint8Array;
  manifest: SlimgV2Manifest;
  assets: Map<string, Uint8Array>;
} {
  const fallback = new TextEncoder().encode('native-fallback');
  const font = new TextEncoder().encode('native-font');
  const physical = new TextEncoder().encode('rust-wasm-state');
  const assets = new Map<string, Uint8Array>([
    ['fallback.png', fallback],
    ['font.woff2', font],
    ['physical.bin', physical],
  ]);
  const common = {
    visible: true,
    locked: false,
    alphaLocked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    clippingMask: false,
  };
  const manifest: SlimgV2Manifest = {
    format: 'signal-loom-image',
    formatVersion: 2,
    kind: 'image',
    generator: { name: 'Hane test', version: 2, brushEngine: 'Tiltmark Rust-WASM' },
    document: {
      id: 'hane-native-constructs',
      title: 'Native constructs',
      width: 64,
      height: 48,
      dpi: 300,
      background: 'transparent',
      activeLayerId: 'vector',
      layers: [
        {
          ...common,
          id: 'vector',
          name: 'Portable vector',
          kind: 'vector',
          transform: {
            affine: [2, 0, 0, 1, 3, 4],
            skew: { xRad: 0.2, yRad: -0.1 },
            perspective: {
              matrix: [1, 0.1, 0, 0.05, 1, 0, 0.001, -0.002, 1],
            },
            cornerDistort: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 64, y: 1 },
              bottomRight: { x: 62, y: 48 },
              bottomLeft: { x: 1, y: 47 },
            },
            warpMesh: {
              columns: 3,
              rows: 2,
              points: [
                { x: 3, y: 4 },
                { x: 35, y: 5 },
                { x: 67, y: 4 },
                { x: 3, y: 52 },
                { x: 35, y: 51 },
                { x: 67, y: 52 },
              ],
            },
          },
          vector: {
            format: 'hane-path-recipe-v2',
            recipe: { paths: [{ id: 'path', commands: ['M0 0', 'L8 8'] }] },
          },
          rasterFallback: { assetId: 'fallback.png', width: 64, height: 48 },
        },
        {
          ...common,
          id: 'text',
          name: 'Managed text',
          kind: 'text',
          transform: { affine: [1, 0, 0, 1, 0, 0] },
          text: {
            content: 'Editable',
            direction: 'horizontal',
            fontFamily: 'Fixture Sans',
            fontAssetId: 'font.woff2',
            fontWeight: 500,
            fontStyle: 'normal',
            fontSizePx: 24,
            kerning: true,
            letterSpacingPx: 1,
            baselineShiftPx: 0,
            lineHeight: 1.3,
            alignment: 'start',
            wrapWidthPx: 63,
            fill: '#112233',
            stroke: { color: '#ffffff', widthPx: 1 },
          },
          rasterFallback: { assetId: 'fallback.png', width: 64, height: 48 },
        },
        {
          ...common,
          id: 'levels',
          name: 'Levels',
          kind: 'adjustment',
          transform: { affine: [1, 0, 0, 1, 0, 0] },
          adjustment: {
            kind: 'levels',
            parameters: { inputBlack: 0.1, inputWhite: 0.9 },
            clippingAware: false,
          },
          rasterFallback: { assetId: 'fallback.png', width: 64, height: 48 },
        },
      ],
      guides: [],
      color: { workingSpace: 'srgb' },
      physical: {
        version: 5,
        layers: [{
          layerId: 'vector',
          stateAssetId: 'physical.bin',
          byteLength: physical.byteLength,
        }],
      },
      sourceApplication: 'Hane',
    },
    assets: [
      assetRecord('fallback.png', fallback, 'raster-fallback', 'image/png'),
      assetRecord('font.woff2', font, 'font', 'font/woff2'),
      assetRecord(
        'physical.bin',
        physical,
        'physical-state',
        'application/octet-stream',
      ),
    ],
  };
  return {
    bytes: packContainer(manifest as unknown as Parameters<typeof packContainer>[0], assets),
    manifest,
    assets,
  };
}

beforeEach(() => {
  globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
  clearAllImageSlimgRuntimeStatesForTests();
});

describe('Sloom Image .slimg v2 runtime boundary', () => {
   it('round-trips LUT values through JSON manifest and preserves rendered pixels', async () => {
    const source = documentFixture();
    const lutData = new Uint8ClampedArray(256);
    for (let index = 0; index < 256; index += 1) lutData[index] = 255 - index;
    source.layers.push({
      id: 'lut', name: 'LUT', type: 'adjustment', visible: true, locked: false, opacity: 1,
      blendMode: 'normal', x: 0, y: 0, bitmap: bitmap(64, 48, 'LUT'), bitmapVersion: 1, mask: null,
      adjustment: { kind: 'lut', channel: 'rgb', lutData, lutDataValues: Array.from(lutData) },
    });
    const bytes = await serializeSlimgV2(source, codec);
    const { manifest } = unpackContainer(bytes);
    const reparsed = JSON.parse(JSON.stringify(manifest)) as SlimgV2Manifest;
    const adjustmentRecord = reparsed.document.layers.find((layer) => layer.id === 'lut');
    expect(adjustmentRecord?.kind).toBe('adjustment');
    expect((adjustmentRecord as Extract<SlimgV2Manifest['document']['layers'][number], { kind: 'adjustment' }>).adjustment.parameters.lutDataValues).toEqual(Array.from(lutData));
    const reopened = await deserializeSlimgAnyVersion(bytes, codec);
    const settings = reopened.layers.find((layer) => layer.id === 'lut')?.adjustment;
    expect(settings?.kind).toBe('lut');
    const reopenedLut = settings as Extract<typeof settings, { kind: 'lut' }>;
    const reopenedValues = reopenedLut.lutDataValues ?? Object.values(reopenedLut.lutData ?? {}).map(Number);
    expect(reopenedValues).toEqual(Array.from(lutData));
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) } as ImageData;
    expect(Array.from(applyAdjustmentToImageData(pixels, settings!).data)).toEqual([245, 235, 225, 255]);
  });
  it('retains MH-051 adjustment settings, Blend If, and named layer comps through .slimg v2 native save/reopen', async () => {
    const source = documentFixture();
    source.layers = [{ ...source.layers[0], bitmap: null, vectorRecipe: undefined, metadata: undefined }];
    source.layers[0] = {
      ...source.layers[0],
      bitmap: null,
      blendIf: { sourceBlack: 24, sourceWhite: 220 },
    };
    source.layers.push({
      id: 'mixer', name: 'Channel Mixer', type: 'adjustment', visible: true, locked: false, opacity: 1,
      blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null,
      adjustment: { kind: 'channelMixer', red: [0, 100, 0], green: [0, 100, 0], blue: [0, 0, 100], constant: [0, 0, 0] },
    });
    source.layerComps = [{ id: 'comp-night', name: 'Night', createdAt: 1, layers: source.layers.map((layer) => ({ layerId: layer.id, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode })) }];
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(source, codec), codec);
    expect(reopened.layers.find((layer) => layer.id === source.layers[0].id)?.blendIf).toEqual({ sourceBlack: 24, sourceWhite: 220 });
    expect(reopened.layers.find((layer) => layer.id === 'mixer')?.adjustment).toMatchObject({ kind: 'channelMixer', red: [0, 100, 0] });
    expect(reopened.layerComps).toMatchObject([{ name: 'Night', layers: expect.any(Array) }]);
  });
  it('carries MH-051 Layer Comp renames and deletions through .slimg v2 native save/reopen', async () => {
    const source = documentFixture();
    const toState = () => source.layers.map((layer) => ({ layerId: layer.id, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode }));
    source.layerComps = [
      { id: 'comp-night', name: 'Night inks', createdAt: 1, layers: toState() },
      { id: 'comp-day', name: 'Day proofs', createdAt: 2, layers: toState() },
      { id: 'comp-sunset', name: 'Sunset drafts', createdAt: 3, layers: toState() },
    ];
    const renamed = renameImageLayerComp(source.layerComps, 'comp-night', 'Final lock');
    if (!renamed.ok) throw new Error('rename should succeed');
    const mutated = deleteImageLayerComp(renamed.comps, 'comp-sunset');
    if (!mutated.ok) throw new Error('delete should succeed');
    source.layerComps = mutated.comps;
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(source, codec), codec);
    expect(reopened.layerComps).toMatchObject([
      { id: 'comp-night', name: 'Final lock' },
      { id: 'comp-day', name: 'Day proofs' },
    ]);
    // Deleted comps stay deleted across reopen; no blank or resurrected entries appear.
    expect(reopened.layerComps?.some((comp) => comp.name === 'Sunset drafts')).toBe(false);
    expect(reopened.layerComps?.every((comp) => comp.name.trim().length > 0)).toBe(true);
  });
  it('writes v2 with hashes, native records, editable vector data, and a raster fallback', async () => {
    const bytes = await serializeSlimgV2(documentFixture(), codec);
    const { manifest, assets } = unpackContainer(bytes);
    const v2 = manifest as unknown as SlimgV2Manifest;

    expect(v2.formatVersion).toBe(2);
    expect(v2.document.sloomStudio).toMatchObject({
      schemaVersion: 1,
      nativeDocumentAssetId: expect.stringContaining('other-'),
    });
    expect(v2.document.layers).toEqual([
      expect.objectContaining({
        id: 'paint',
        kind: 'raster',
        pixels: expect.objectContaining({ assetId: expect.stringContaining('pixels-') }),
      }),
      expect.objectContaining({
        id: 'vector',
        kind: 'vector',
        vector: {
          format: 'sloom-svg-v1',
          recipe: { source: expect.stringContaining('<svg') },
        },
        rasterFallback: expect.objectContaining({
          assetId: expect.stringContaining('raster-fallback-'),
        }),
      }),
    ]);
    for (const record of v2.assets) {
      const payload = assets.get(record.id);
      expect(payload).toBeDefined();
      expect(record.byteLength).toBe(payload!.byteLength);
      expect(record.sha256).toBe(sha256Hex(payload!));
    }
  });

  it('round-trips Sloom native structure through its verified v2 envelope', async () => {
    const source = documentFixture();
    source.metadata = {
      artboards: {
        activeArtboardId: 'cover',
        artboards: [{
          id: 'cover',
          name: 'Cover',
          x: 4,
          y: 3,
          width: 56,
          height: 40,
          proofLabel: 'Trim proof',
          page: { preset: 'custom', widthMm: 4.7413, heightMm: 3.3867, bleedMm: 3, dpi: 300 },
        }],
      },
      colorProof: { mode: 'cmyk-soft-proof', intent: 'relative-colorimetric', profileLabel: 'FOGRA39' },
    };
    const out = await deserializeSlimgAnyVersion(
      await serializeSlimgV2(source, codec),
      codec,
    );

    expect(out).toMatchObject({
      id: source.id,
      title: source.title,
      dirty: false,
      activeLayerId: 'vector',
      guides: [{ id: 'guide-x', axis: 'x', position: 12 }],
      layers: [
        { id: 'paint', type: 'image', bitmapVersion: 3 },
        {
          id: 'vector',
          type: 'vector',
          x: 3,
          y: 4,
          rotationDeg: 12,
          vectorRecipe: expect.stringContaining('<svg'),
        },
      ],
    });
    expect((out.layers[0]!.bitmap as unknown as { __tag: string }).__tag).toBe('PAINT');
    expect((out.layers[1]!.bitmap as unknown as { __tag: string }).__tag).toBe('VECTOR-FALLBACK');
    expect(getImageSlimgRuntimeState(out.id)?.sourceVersion).toBe(2);
    expect(out.metadata?.artboards).toEqual(source.metadata.artboards);
    expect(out.metadata?.colorProof).toEqual(source.metadata.colorProof);
  });

  it('round-trips retained frame animation and onion-skin intent', async () => {
    const source = documentFixture();
    source.metadata = { animation: {
      version: 1, frameRate: 12, currentFrameId: 'frame-2',
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [
        { id: 'frame-1', name: 'Frame 1', durationMs: 1000 / 12, layerVisibility: { paint: true, vector: false } },
        { id: 'frame-2', name: 'Frame 2', durationMs: 1000 / 12, layerVisibility: { paint: false, vector: true } },
      ],
    } };
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(source, codec), codec);
    expect(reopened.metadata?.animation).toEqual(source.metadata?.animation);
  });

  it('round-trips retained Reduce Noise intent through the production v2 envelope', async () => {
    const source = documentFixture();
    source.layers[0] = {
      ...source.layers[0]!,
      filters: [{
        id: 'portrait-denoise',
        kind: 'denoise',
        enabled: true,
        amount: 60,
        opacity: 1,
        blendMode: 'normal',
      }],
    };

    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(source, codec), codec);

    expect(reopened.layers[0]?.filters).toEqual(source.layers[0]?.filters);
  });

  it('round-trips high-bit source provenance without claiming high-bit working pixels', async () => {
    const source = documentFixture();
    source.metadata = { sourceFormat: 'PNG', sourceMimeType: 'image/png', sourceBitDepth: 32 };

    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(source, codec), codec);
    expect(reopened.metadata).toMatchObject({ sourceFormat: 'slimg', sourceMimeType: 'image/png', sourceBitDepth: 32 });
    expect(reopened.layers[0]?.bitmap).toBeTruthy();
  });

  it('serializes the runtime Pen-path builder without an undefined preset field', async () => {
    const source = documentFixture();
    const penPath = buildVectorPathLayer({
      doc: source,
      points: [{ x: 4, y: 8, outHandle: { x: 16, y: 2 } }, { x: 36, y: 20, inHandle: { x: 24, y: 28 } }],
      closed: false,
      settings: { fillColor: '#000000', fillOpacity: 0, strokeColor: '#ffffff', strokeOpacity: 1, strokeWidth: 2 },
    });
    source.layers = [penPath];
    source.activeLayerId = penPath.id;
    await expect(serializeSlimgV2(source, codec)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('persists a linked mask source id without duplicating the source alpha asset', async () => {
    const source = documentFixture();
    source.layers[0] = { ...source.layers[0]!, mask: bitmap(64, 48, 'SOURCE-MASK') };
    source.layers[1] = { ...source.layers[1]!, maskLinkSourceLayerId: 'paint' };
    const bytes = await serializeSlimgV2(source, codec);
    const manifest = unpackContainer(bytes).manifest as unknown as SlimgV2Manifest;
    expect(manifest.document.layers.find((layer) => layer.id === 'vector')).toMatchObject({
      maskLinkSourceLayerId: 'paint',
    });
    const reopened = await deserializeSlimgAnyVersion(bytes, codec);
    expect(reopened.layers.find((layer) => layer.id === 'vector')).toMatchObject({
      maskLinkSourceLayerId: 'paint',
    });
  });

  it('persists and reopens every supported editable text-warp intent', async () => {
    const source = documentFixture();
    source.layers = [{
      id: 'warped-text',
      name: 'Warped title',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 2,
      y: 3,
      bitmap: bitmap(64, 48, 'BULGED-TEXT'),
      bitmapVersion: 1,
      mask: null,
      text: {
        content: 'Sloom',
        fontFamily: 'Fixture Sans',
        fontSize: 24,
        fontWeight: '600',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: null,
        boxHeight: null,
        wrap: true,
        color: '#112233',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'arc',
      },
      metadata: { editableText: true },
    }];
    source.activeLayerId = 'warped-text';

    for (const warp of ['arc', 'flag', 'bulge'] as const) {
      source.layers[0] = {
        ...source.layers[0]!,
        text: { ...source.layers[0]!.text!, warp },
      };
      const bytes = await serializeSlimgV2(source, codec);
      const manifest = unpackContainer(bytes).manifest as unknown as SlimgV2Manifest;
      expect(manifest.document.layers.find((layer) => layer.id === 'warped-text')).toMatchObject({
        kind: 'text',
        text: { warp },
      });
      await expect(deserializeSlimgAnyVersion(bytes, codec)).resolves.toMatchObject({
        layers: [expect.objectContaining({
          id: 'warped-text',
          text: expect.objectContaining({ warp }),
        })],
      });
    }
  });

  it('opens the Hane v2 golden after hash verification without native Sloom data', async () => {
    const out = await deserializeSlimgAnyVersion(haneArchive(haneV2Golden), codec);

    expect(out).toMatchObject({
      id: 'golden-document',
      title: 'v2 golden',
      width: 64,
      height: 48,
      activeLayerId: 'paint',
      layers: [{ id: 'paint', type: 'image' }],
    });
    expect((out.layers[0]!.bitmap as unknown as { __tag: string }).__tag).toBe('pixels');
  });

  it('preserves Hane vector, font, transform, adjustment, and opaque Rust-WASM state on resave', async () => {
    const source = nativeConstructArchive();
    const opened = await deserializeSlimgAnyVersion(source.bytes, codec);
    const vector = opened.layers.find((layer) => layer.id === 'vector');

    expect(vector?.warpMesh).toMatchObject({ columns: 2, rows: 1 });
    expect(vector?.warpMesh?.points).toHaveLength(6);
    expect(vector?.warpMesh?.points[0]).toEqual({ x: 0, y: 0 });
    expect(vector?.warpMesh?.points[1]).toEqual({ x: 0, y: 1 / 48 });
    expect(vector?.tiltmarkSimulationData).toBeUndefined();
    expect(vector?.metadata?.tiltmark).toBeUndefined();

    const saved = unpackContainer(await serializeSlimgV2(opened, codec));
    const manifest = saved.manifest as unknown as SlimgV2Manifest;
    const sourceVector = source.manifest.document.layers[0]!;
    const savedVector = manifest.document.layers.find((layer) => layer.id === 'vector');
    const savedText = manifest.document.layers.find((layer) => layer.id === 'text');
    const savedAdjustment = manifest.document.layers.find((layer) => layer.id === 'levels');

    expect(savedVector).toMatchObject({
      kind: 'vector',
      vector: sourceVector.kind === 'vector' ? sourceVector.vector : {},
      transform: sourceVector.transform,
    });
    expect(savedText).toMatchObject({
      kind: 'text',
      text: {
        fontAssetId: 'font.woff2',
        stroke: { color: '#ffffff', widthPx: 1 },
      },
    });
    expect(savedAdjustment).toMatchObject({
      kind: 'adjustment',
      adjustment: {
        kind: 'levels',
        parameters: { inputBlack: 0.1, inputWhite: 0.9 },
        clippingAware: false,
      },
    });
    expect(manifest.document.physical).toEqual(source.manifest.document.physical);
    expect(saved.assets.get('font.woff2')).toEqual(source.assets.get('font.woff2'));
    expect(saved.assets.get('physical.bin')).toEqual(source.assets.get('physical.bin'));
  });

  it('migrates Hane v1 in memory and carries the exact archive into the next verified v2 save', async () => {
    const v1Bytes = haneArchive(haneV1Golden);
    const migrated = await deserializeSlimgAnyVersion(v1Bytes, codec);
    const migrationState = getImageSlimgRuntimeState(migrated.id);

    expect(migrationState?.sourceVersion).toBe(1);
    expect(migrationState?.migrationBackup?.bytes).toEqual(v1Bytes);
    expect(migrationState?.migrationBackup?.bytes).not.toBe(v1Bytes);

    const v2Bytes = await serializeSlimgV2(migrated, codec);
    const { manifest, assets } = unpackContainer(v2Bytes);
    const v2 = manifest as unknown as SlimgV2Manifest;
    const backupId = v2.document.migrationBackupAssetId;
    expect(backupId).toBe('original-v1-migration-backup.slimg');
    expect(assets.get(backupId!)).toEqual(v1Bytes);
    expect(v2.assets.find((record) => record.id === backupId)).toMatchObject({
      role: 'migration-backup',
      byteLength: v1Bytes.byteLength,
    });
  });

  it('rejects a v2 hash mismatch before decoding pixels', async () => {
    const decode = vi.fn(codec.decode);
    const malformed = structuredClone(haneV2Golden);
    malformed.assets[0]!.sha256 = '0'.repeat(64);

    await expect(deserializeSlimgAnyVersion(
      haneArchive(malformed),
      { ...codec, decode },
    )).rejects.toThrow('SHA-256');
    expect(decode).not.toHaveBeenCalled();
  });

  it('produces an explicit flattened v1 compatibility archive and report', async () => {
    const result = await serializeSlimgV1Compatibility(documentFixture(), codec);
    const { manifest } = unpackContainer(result.bytes);

    expect(manifest.formatVersion).toBe(1);
    expect(result.report).toMatchObject({
      sourceVersion: 2,
      targetVersion: 1,
      flattenedLayers: [{
        layerId: 'vector',
        reasons: expect.arrayContaining(['vector-recipe', 'skew']),
        fallbackAssetId: expect.stringContaining('raster-fallback-'),
      }],
    });
  });

  it('rejects undeclared archive members before publishing a document', async () => {
    const bytes = await serializeSlimgV2(documentFixture(), codec);
    const { manifest, assets } = unpackContainer(bytes);
    assets.set('unlisted.bin', new Uint8Array([1]));
    const malformed = packContainer(manifest, assets);

    await expect(deserializeSlimgAnyVersion(malformed, codec))
      .rejects.toThrow('undeclared asset');
  });

  it('round-trips a byte-verified embedded Smart Object source and its shared instance placement', async () => {
    const doc = documentFixture();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source = {
      id: 'smart-a', kind: 'embedded' as const, mimeType: 'image/png', byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes), nativeWidth: 64, nativeHeight: 48, label: 'Plate', version: 2,
      embeddedBytes: bytes,
    };
    doc.layers[0] = { ...doc.layers[0]!, smartObject: { sourceId: 'smart-a', placement: { width: 128, height: 96 }, renderedVersion: 2 } };
    doc.metadata = { smartSources: { 'smart-a': source } };
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(doc, codec), codec);
    expect(reopened.metadata?.smartSources?.['smart-a']).toMatchObject({ sha256: source.sha256, byteLength: 4, bytesAssetId: expect.stringContaining('smart-source-') });
    expect(reopened.metadata?.smartSources?.['smart-a']?.embeddedBytes).toEqual(bytes);
    expect(reopened.layers[0]?.smartObject).toEqual({ sourceId: 'smart-a', placement: { width: 128, height: 96 }, renderedVersion: 2 });
  });

  it('preserves native CMYKA authority while v2 restores smart-source assets', async () => {
    const doc = documentFixture();
    const embedded = new Uint8Array([1, 2, 3, 4]);
    const authority = createImageCmykPixelBuffer(64, 48, new Uint8Array(64 * 48 * 5).fill(37));
    doc.layers[0] = {
      ...doc.layers[0]!,
      cmykPixels: authority,
      smartObject: { sourceId: 'smart-cmyk', placement: { width: 64, height: 48 }, renderedVersion: 1 },
    };
    doc.metadata = {
      colorMode: 'cmyk',
      cmyk: {
        profileId: 'fogra39', profileLabel: 'FOGRA39',
        profileSource: { kind: 'bundled', id: 'fogra39' },
        intent: 'relative', blackPointCompensation: true,
      },
      smartSources: {
        'smart-cmyk': {
          id: 'smart-cmyk', kind: 'embedded', mimeType: 'image/png', byteLength: embedded.byteLength,
          sha256: sha256Hex(embedded), nativeWidth: 64, nativeHeight: 48, label: 'CMYK source', version: 1,
          embeddedBytes: embedded,
        },
      },
    };
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(doc, codec), codec);
    expect(reopened.metadata?.colorMode).toBe('cmyk');
    expect(reopened.layers[0]?.cmykPixels?.data).toEqual(authority.data);
    expect(reopened.metadata?.smartSources?.['smart-cmyk']?.embeddedBytes).toEqual(embedded);
  });

  it('round-trips one source-shared Smart Filter stack across its retained Smart Object instances', async () => {
    const doc = documentFixture();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source = {
      id: 'smart-a', kind: 'embedded' as const, mimeType: 'image/png', byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes), nativeWidth: 64, nativeHeight: 48, label: 'Plate', version: 2,
      embeddedBytes: bytes,
    };
    const first = { ...doc.layers[0]!, smartObject: { sourceId: 'smart-a', placement: { width: 64, height: 48 }, renderedVersion: 2 } };
    const second = { ...doc.layers[1]!, id: 'smart-copy', smartObject: { sourceId: 'smart-a', placement: { width: 32, height: 24 }, renderedVersion: 2 } };
    const shared = replaceSmartObjectFilterStack([first, second], 'smart-a', [{
      id: 'blur', kind: 'blur', enabled: true, amount: 8, opacity: 0.5, blendMode: 'screen',
      mask: { width: 2, height: 1, alpha: [255, 64] },
    }]);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    doc.layers = shared.layers;
    doc.activeLayerId = first.id;
    doc.metadata = { smartSources: { 'smart-a': source } };

    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(doc, codec), codec);
    expect(reopened.layers.map((layer) => layer.filters)).toEqual([
      [{ id: 'blur', kind: 'blur', enabled: true, amount: 8, opacity: 0.5, blendMode: 'screen', mask: { width: 2, height: 1, alpha: [255, 64] } }],
      [{ id: 'blur', kind: 'blur', enabled: true, amount: 8, opacity: 0.5, blendMode: 'screen', mask: { width: 2, height: 1, alpha: [255, 64] } }],
    ]);
  });

  it('refuses a Smart Filter mask asset that is missing from the verified v2 manifest', async () => {
    const doc = documentFixture();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    doc.layers[0] = {
      ...doc.layers[0]!,
      smartObject: { sourceId: 'smart-a', placement: { width: 64, height: 48 }, renderedVersion: 1 },
      filters: [{
        id: 'blur', kind: 'blur', enabled: true, amount: 4, opacity: 1, blendMode: 'normal',
        mask: { width: 1, height: 1, alpha: [255] },
      }],
    };
    doc.metadata = {
      smartSources: {
        'smart-a': {
          id: 'smart-a', kind: 'embedded', mimeType: 'image/png', byteLength: 4,
          sha256: sha256Hex(bytes), nativeWidth: 64, nativeHeight: 48, label: 'Plate', version: 1,
          embeddedBytes: bytes,
        },
      },
    };
    const archive = unpackContainer(await serializeSlimgV2(doc, codec));
    const manifest = structuredClone(archive.manifest) as unknown as SlimgV2Manifest;
    manifest.document.layers[0]!.smartFilters![0]!.mask!.assetId = 'missing-smart-filter-mask.alpha';

    await expect(deserializeSlimgAnyVersion(packContainer(manifest as unknown as ContainerManifest, archive.assets), codec))
      .rejects.toThrow('undeclared asset');
  });

  it('refuses a hostile Smart Object manifest that points at a missing or mismatched source asset', async () => {
    const doc = documentFixture();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    doc.layers[0] = { ...doc.layers[0]!, smartObject: { sourceId: 'smart-a', placement: { width: 8, height: 8 }, renderedVersion: 1 } };
    doc.metadata = { smartSources: { 'smart-a': { id: 'smart-a', kind: 'embedded', mimeType: 'image/png', byteLength: 4, sha256: sha256Hex(bytes), nativeWidth: 2, nativeHeight: 2, label: 'Plate', version: 1, embeddedBytes: bytes } } };
    const archive = unpackContainer(await serializeSlimgV2(doc, codec));
    const manifest = structuredClone(archive.manifest) as unknown as SlimgV2Manifest;
    manifest.document.smartSources![0]!.bytesAssetId = 'missing-smart-source.bin';
    await expect(deserializeSlimgAnyVersion(packContainer(manifest as unknown as ContainerManifest, archive.assets), codec)).rejects.toThrow('source asset is invalid');
  });
});
