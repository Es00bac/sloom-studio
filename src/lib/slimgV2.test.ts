import { describe, expect, it } from 'vitest';
import haneV1Golden from './fixtures/slimg-v1-hane-golden.json';
import haneV2Golden from './fixtures/slimg-v2-hane-golden.json';
import {
  SLIMG_V2_LIMITS,
  createSlimgV2AssetRecord,
  exportSlimgV1CompatibilityCopy,
  readSlimgManifest,
  sha256Hex,
  validateSlimgV2Manifest,
  verifySlimgV2Assets,
  type SlimgV2AssetRecord,
  type SlimgV2Manifest,
} from './slimgV2';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

async function comprehensiveFixture(): Promise<{
  manifest: SlimgV2Manifest;
  assets: Map<string, Uint8Array>;
}> {
  const assets = new Map<string, Uint8Array>([
    ['pixels.png', encode('pixels')],
    ['fallback.png', encode('fallback')],
    ['mask.alpha', encode('mask')],
    ['proof.icc', encode('profile')],
    ['font.woff2', encode('font')],
    ['keyframe.png', encode('keyframe')],
    ['delta.png', encode('delta')],
    ['physical.json', encode('physical')],
    ['native.slimg', encode('native')],
  ]);
  const metadata: Record<string, Pick<SlimgV2AssetRecord, 'mimeType' | 'role'>> = {
    'pixels.png': { mimeType: 'image/png', role: 'pixels' },
    'fallback.png': { mimeType: 'image/png', role: 'raster-fallback' },
    'mask.alpha': { mimeType: 'application/octet-stream', role: 'selection-mask' },
    'proof.icc': { mimeType: 'application/vnd.iccprofile', role: 'icc-profile' },
    'font.woff2': { mimeType: 'font/woff2', role: 'font' },
    'keyframe.png': { mimeType: 'image/png', role: 'timelapse' },
    'delta.png': { mimeType: 'image/png', role: 'timelapse' },
    'physical.json': { mimeType: 'application/json', role: 'physical-state' },
    'native.slimg': { mimeType: 'application/x-sloom-slimg', role: 'other' },
  };
  const records = await Promise.all([...assets].map(([id, bytes]) => (
    createSlimgV2AssetRecord(id, bytes, metadata[id]!)
  )));
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
    generator: { name: 'Sloom test', version: 2, brushEngine: 'Studio + Tiltmark' },
    document: {
      id: 'complete-v2',
      title: 'Complete v2 fixture',
      width: 64,
      height: 48,
      dpi: 300,
      background: 'transparent',
      activeLayerId: 'paint',
      layers: [
        {
          ...common,
          id: 'folder',
          name: 'Folder',
          kind: 'group',
          transform: { affine: [1, 0, 0, 1, 0, 0] },
          expanded: true,
        },
        {
          ...common,
          id: 'paint',
          name: 'Paint',
          kind: 'raster',
          parentId: 'folder',
          transform: { affine: [1, 0, 0, 1, 0, 0] },
          pixels: { assetId: 'pixels.png', width: 64, height: 48 },
        },
        {
          ...common,
          id: 'shape',
          name: 'Shape',
          kind: 'vector',
          parentId: 'folder',
          transform: {
            affine: [2, 0, 0, 1, 3, 4],
            skew: { xRad: 0.2, yRad: -0.1 },
            perspective: { matrix: [1, 0, 0, 0, 1, 0, 0.001, 0, 1] },
            cornerDistort: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 64, y: 1 },
              bottomRight: { x: 62, y: 48 },
              bottomLeft: { x: 1, y: 47 },
            },
            warpMesh: {
              columns: 2,
              rows: 2,
              points: [
                { x: 0, y: 0 }, { x: 64, y: 0 },
                { x: 0, y: 48 }, { x: 64, y: 48 },
              ],
            },
          },
          vector: {
            format: 'portable-paths-v2',
            recipe: { paths: [{ id: 'path', closed: true }] },
          },
          rasterFallback: { assetId: 'fallback.png', width: 64, height: 48 },
        },
        {
          ...common,
          id: 'caption',
          name: 'Caption',
          kind: 'text',
          transform: { affine: [1, 0, 0, 1, 0, 0] },
          text: {
            content: '縦書き\nEditable',
            direction: 'vertical-rl',
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
            warp: 'bulge',
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
            clippingAware: true,
          },
          rasterFallback: { assetId: 'fallback.png', width: 64, height: 48 },
        },
      ],
      selection: {
        mask: {
          assetId: 'mask.alpha',
          width: 64,
          height: 48,
          encoding: 'alpha8',
        },
        sourceLayerId: 'paint',
        recipe: {
          kind: 'lasso',
          points: [{ x: 1, y: 1 }, { x: 30, y: 2 }, { x: 4, y: 20 }],
        },
      },
      guides: [{
        id: 'perspective',
        kind: 'perspective-two-point',
        enabled: true,
        assisted: true,
        opacity: 0.4,
        points: [{ x: -20, y: 24 }, { x: 84, y: 24 }],
      }],
      color: {
        workingSpace: 'display-p3',
        workingProfileAssetId: 'proof.icc',
        proof: {
          profileAssetId: 'proof.icc',
          sourceSpace: 'cmyk',
          intent: 'perceptual',
          blackPointCompensation: true,
          gamutWarning: true,
        },
      },
      timelapse: {
        initialKeyframeAssetId: 'keyframe.png',
        durationMs: 1000,
        chunks: [{
          assetId: 'delta.png',
          timestampMs: 500,
          kind: 'dirty-tile-delta',
          x: 0,
          y: 0,
          width: 32,
          height: 24,
        }],
      },
      physical: {
        version: 5,
        documentStateAssetId: 'physical.json',
        layers: [],
      },
      sourceApplication: 'Sloom test',
      sloomStudio: {
        schemaVersion: 1,
        nativeDocumentAssetId: 'native.slimg',
      },
    },
    assets: records,
  };
  return { manifest, assets };
}

describe('.slimg v2 Hane/Sloom golden interchange', () => {
  it('accepts Hane v2 and verifies its exact SHA-256 asset', async () => {
    const manifest = validateSlimgV2Manifest(haneV2Golden);
    await expect(verifySlimgV2Assets(
      manifest,
      new Map([['pixels.png', encode('pixels')]]),
    )).resolves.toBeUndefined();
    expect(manifest.document.layers[0]).toMatchObject({
      kind: 'raster',
      pixels: { assetId: 'pixels.png', width: 64, height: 48 },
    });
  });

  it('migrates Hane v1 repeatably and retains exact source bytes', async () => {
    const originalManifest = structuredClone(haneV1Golden);
    const originalBytes = encode('exact original archive');
    const first = await readSlimgManifest(
      haneV1Golden,
      new Map([['pixels.png', encode('pixels')]]),
      { originalV1ArchiveBytes: originalBytes },
    );
    const second = await readSlimgManifest(
      haneV1Golden,
      new Map([['pixels.png', encode('pixels')]]),
      { originalV1ArchiveBytes: originalBytes },
    );

    expect(haneV1Golden).toEqual(originalManifest);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      sourceVersion: 1,
      migrated: true,
      manifest: {
        formatVersion: 2,
        document: {
          activeLayerId: 'paint',
          migrationBackupAssetId: 'original-v1-migration-backup.slimg',
          layers: [{
            id: 'paint',
            kind: 'raster',
            pixels: { assetId: 'pixels.png', width: 64, height: 48 },
          }],
        },
      },
    });
    expect(first.migrationBackup?.bytes).toEqual(originalBytes);
    expect(first.migrationBackup?.bytes).not.toBe(originalBytes);
    expect(first.manifest.assets[0]?.sha256).toBe(sha256Hex(encode('pixels')));
  });

  it('accepts every v2 layer, transform, extension, and document record', async () => {
    const fixture = await comprehensiveFixture();
    expect(validateSlimgV2Manifest(fixture.manifest)).toBe(fixture.manifest);
    await expect(verifySlimgV2Assets(fixture.manifest, fixture.assets))
      .resolves.toBeUndefined();
  });
});

describe('.slimg v2 hostile boundaries', () => {
  it('rejects duplicate, oversized, missing, undeclared, and hash-mismatched assets', async () => {
    const duplicate = structuredClone(haneV2Golden);
    duplicate.assets.push(structuredClone(duplicate.assets[0]!));
    expect(() => validateSlimgV2Manifest(duplicate)).toThrow('duplicate asset id pixels.png');

    const oversized = structuredClone(haneV2Golden);
    oversized.assets[0]!.byteLength = SLIMG_V2_LIMITS.maxAssetBytes + 1;
    expect(() => validateSlimgV2Manifest(oversized)).toThrow('outside its numeric bounds');

    const manifest = validateSlimgV2Manifest(haneV2Golden);
    await expect(verifySlimgV2Assets(manifest, new Map()))
      .rejects.toThrow('missing asset pixels.png');
    await expect(verifySlimgV2Assets(
      manifest,
      new Map([['pixels.png', encode('pixelz')]]),
    )).rejects.toThrow('SHA-256');
    await expect(verifySlimgV2Assets(
      manifest,
      new Map([
        ['pixels.png', encode('pixels')],
        ['undeclared.png', encode('pixels')],
      ]),
    )).rejects.toThrow('undeclared asset');
  });

  it('rejects malformed warp grids, text warp intent, hierarchy cycles, and missing refs', async () => {
    const fixture = await comprehensiveFixture();
    const malformedWarp = structuredClone(fixture.manifest);
    const vector = malformedWarp.document.layers.find((layer) => layer.kind === 'vector');
    if (vector?.kind === 'vector' && vector.transform.warpMesh) {
      vector.transform.warpMesh.points.pop();
    }
    expect(() => validateSlimgV2Manifest(malformedWarp)).toThrow('point count');

    const malformedTextWarp = structuredClone(fixture.manifest);
    const text = malformedTextWarp.document.layers.find((layer) => layer.kind === 'text');
    if (text?.kind === 'text') (text.text as { warp?: string }).warp = 'ripple';
    expect(() => validateSlimgV2Manifest(malformedTextWarp)).toThrow('text.warp is unsupported');

    const cycle = structuredClone(fixture.manifest);
    const folder = cycle.document.layers.find((layer) => layer.id === 'folder');
    if (folder) folder.parentId = 'folder';
    expect(() => validateSlimgV2Manifest(cycle)).toThrow('cycle');

    const tooDeep = structuredClone(fixture.manifest);
    const template = tooDeep.document.layers.find((layer) => layer.id === 'folder');
    if (template?.kind === 'group') {
      delete tooDeep.document.selection;
      tooDeep.document.layers = Array.from({ length: SLIMG_V2_LIMITS.maxLayerHierarchyDepth + 2 }, (_, index) => ({
        ...template,
        id: `deep-folder-${index}`,
        name: `Deep folder ${index}`,
        ...(index > 0 ? { parentId: `deep-folder-${index - 1}` } : {}),
      }));
      tooDeep.document.activeLayerId = `deep-folder-${SLIMG_V2_LIMITS.maxLayerHierarchyDepth + 1}`;
      expect(() => validateSlimgV2Manifest(tooDeep)).toThrow('layer hierarchy depth exceeds');
    }

    const missing = structuredClone(fixture.manifest);
    const raster = missing.document.layers.find((layer) => layer.kind === 'raster');
    if (raster?.kind === 'raster' && raster.pixels) raster.pixels.assetId = 'missing.png';
    expect(() => validateSlimgV2Manifest(missing)).toThrow('undeclared asset');
  });

  it('refuses oversized retained mesh cages and out-of-bound perspective planes without mutating either rejected record', async () => {
    const meshFixture = await comprehensiveFixture();
    const oversizedMesh = structuredClone(meshFixture.manifest);
    const meshVector = oversizedMesh.document.layers.find((layer) => layer.kind === 'vector');
    if (meshVector?.kind !== 'vector' || !meshVector.transform.warpMesh) throw new Error('fixture must include a mesh vector');
    meshVector.transform.warpMesh.columns = SLIMG_V2_LIMITS.maxWarpColumns + 1;
    const meshBeforeRefusal = JSON.stringify(oversizedMesh);
    expect(() => validateSlimgV2Manifest(oversizedMesh)).toThrow('warpMesh.columns');
    expect(JSON.stringify(oversizedMesh)).toBe(meshBeforeRefusal);

    const planeFixture = await comprehensiveFixture();
    const outOfBoundsPlane = structuredClone(planeFixture.manifest);
    const planeVector = outOfBoundsPlane.document.layers.find((layer) => layer.kind === 'vector');
    if (planeVector?.kind !== 'vector' || !planeVector.transform.perspective) throw new Error('fixture must include a perspective plane');
    planeVector.transform.perspective.matrix[6] = 1_000_001;
    const planeBeforeRefusal = JSON.stringify(outOfBoundsPlane);
    expect(() => validateSlimgV2Manifest(outOfBoundsPlane)).toThrow('perspective.matrix[6]');
    expect(JSON.stringify(outOfBoundsPlane)).toBe(planeBeforeRefusal);
  });

  it('rejects wrong-role font/ICC/native records and missing fallbacks', async () => {
    const fixture = await comprehensiveFixture();
    const font = structuredClone(fixture.manifest);
    const text = font.document.layers.find((layer) => layer.kind === 'text');
    if (text?.kind === 'text') text.text.fontAssetId = 'pixels.png';
    expect(() => validateSlimgV2Manifest(font)).toThrow('font asset');

    const profile = structuredClone(fixture.manifest);
    profile.document.color.workingProfileAssetId = 'pixels.png';
    expect(() => validateSlimgV2Manifest(profile)).toThrow('ICC asset');

    const native = structuredClone(fixture.manifest);
    native.document.sloomStudio!.nativeDocumentAssetId = 'pixels.png';
    expect(() => validateSlimgV2Manifest(native)).toThrow('native data');

    const fallback = structuredClone(fixture.manifest);
    const vector = fallback.document.layers.find((layer) => layer.kind === 'vector');
    if (vector?.kind === 'vector') {
      delete (vector as Partial<typeof vector>).rasterFallback;
    }
    expect(() => validateSlimgV2Manifest(fallback)).toThrow('requires a raster fallback');
  });
});

describe('.slimg v1 compatibility export', () => {
  it('reports exact flattened constructs and omitted document features', async () => {
    const fixture = await comprehensiveFixture();
    const copy = exportSlimgV1CompatibilityCopy(fixture.manifest, fixture.assets);

    expect(copy.manifest.formatVersion).toBe(1);
    expect(copy.report.flattenedLayers).toEqual([
      {
        layerId: 'shape',
        layerName: 'Shape',
        reasons: [
          'vector-recipe',
          'affine-scale-or-shear',
          'skew',
          'perspective',
          'corner-distort',
          'warp-mesh',
        ],
        fallbackAssetId: 'fallback.png',
      },
      {
        layerId: 'caption',
        layerName: 'Caption',
        reasons: ['editable-text'],
        fallbackAssetId: 'fallback.png',
      },
      {
        layerId: 'levels',
        layerName: 'Levels',
        reasons: ['adjustment-layer'],
        fallbackAssetId: 'fallback.png',
      },
    ]);
    expect(copy.report.omittedDocumentFeatures.map((entry) => entry.feature)).toEqual([
      'guides',
      'managed-color',
      'soft-proof',
      'timelapse',
      'physical-state',
    ]);
    expect(copy.report.retainedAssetIds).toEqual([
      'fallback.png',
      'mask.alpha',
      'pixels.png',
    ]);
    expect(copy.report.omittedAssetIds).toEqual([
      'delta.png',
      'font.woff2',
      'keyframe.png',
      'native.slimg',
      'physical.json',
      'proof.icc',
    ]);
  });

  it('retains the explicitly compatible v1 wet-field state and paper profile', async () => {
    const fixture = await comprehensiveFixture();
    fixture.manifest.document.physical = {
      version: 1,
      paperProfile: { id: 'cold-press', absorbency: 0.63 },
      layers: [{
        layerId: 'paint',
        stateAssetId: 'physical.json',
        byteLength: fixture.assets.get('physical.json')!.byteLength,
        tileCount: 3,
        baseBitmap: { assetId: 'pixels.png', width: 64, height: 48 },
        legacyWetFieldVersion: 1,
      }],
    };

    const copy = exportSlimgV1CompatibilityCopy(fixture.manifest, fixture.assets);
    const document = copy.manifest.document;
    const layers = document.layers as Array<Record<string, unknown>>;

    expect(copy.report.omittedDocumentFeatures.map((entry) => entry.feature))
      .not.toContain('physical-state');
    expect(copy.report.retainedAssetIds).toEqual(expect.arrayContaining([
      'physical.json',
      'pixels.png',
    ]));
    expect(document.hanePaperProfile).toEqual({
      id: 'cold-press',
      absorbency: 0.63,
    });
    expect(layers.find((layer) => layer.id === 'paint')).toMatchObject({
      haneWetField: {
        version: 1,
        asset: 'physical.json',
        byteLength: fixture.assets.get('physical.json')!.byteLength,
        tileCount: 3,
        baseBitmap: {
          asset: 'pixels.png',
          width: 64,
          height: 48,
        },
      },
    });
  });
});
