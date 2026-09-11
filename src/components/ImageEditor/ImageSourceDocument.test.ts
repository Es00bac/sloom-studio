import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';

// Mock the served-LAN-session predicate and the host asset loader so the served path can be exercised
// deterministically. Both default to "not a served session" (matching desktop/Electron/native), so the
// rest of the suite is unaffected; the served tests opt in via mockReturnValue/mockResolvedValue.
vi.mock('../../lib/projectLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectLibrary')>();
  return { ...actual, isRemoteLanClient: vi.fn(() => false) };
});
vi.mock('../../lib/assetStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/assetStore')>();
  return { ...actual, loadImportedAssetAsDataUrl: vi.fn() };
});
// The host's universal source-asset endpoint is the primary served-session resolver (it serves
// native-file/scratch-backed items too). Default it to "no hosted bytes" so the existing assetId
// fallback tests still exercise loadImportedAssetAsDataUrl; the native-file test opts in.
vi.mock('../../lib/remoteHostClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/remoteHostClient')>();
  return { ...actual, fetchRemoteHostSourceAssetDataUrl: vi.fn(() => Promise.resolve(null)) };
});

import {
  createImageDocumentFromClipboard,
  createImageDocumentFromFile,
  createImageDocumentFromSourceItem,
  createSourceBackedImageDocumentShell,
  describeImageSourceLibraryHandoff,
  describeSourceLinkedLayerReadiness,
  describeImageSourceDocumentRoundtripRisk,
  describeImageSourceOpenWorkflow,
  loadSourceLinkedLayerBitmap,
  replaceSourceLinkedLayerBitmap,
} from './ImageSourceDocument';
import { clearImageClipboard, copyLayerPixelsToClipboard } from './ImageEditorClipboard';
import { isRemoteLanClient } from '../../lib/projectLibrary';
import { loadImportedAssetAsDataUrl } from '../../lib/assetStore';
import { fetchRemoteHostSourceAssetDataUrl } from '../../lib/remoteHostClient';
import { encodePng16Rgba } from './codecs/png16';
import { encodeExr } from './codecs/exr';
import { encodeHighBitTiff } from './codecs/tiffHighBit';

class FakeContext {
  drawImage() {}
  putImageData() {}
}

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

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function imageItem(): SourceBinLibraryItem {
  return {
    id: 'cover-art',
    label: 'Cover Art',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: 'data:image/png;base64,test',
    createdAt: 1,
  };
}

describe('ImageSourceDocument', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    globalThis.ImageData = FakeImageData as unknown as typeof ImageData;
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 48,
      height: 27,
      close: vi.fn(),
    })) as unknown as typeof createImageBitmap;
    // Default every test to a non-served (desktop/Electron/native) session.
    vi.mocked(isRemoteLanClient).mockReturnValue(false);
    vi.mocked(loadImportedAssetAsDataUrl).mockReset();
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockReset();
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockResolvedValue(null);
  });

  it('creates a source-backed shell for lazy image loading fallbacks', () => {
    const doc = createSourceBackedImageDocumentShell(imageItem());

    expect(doc).toMatchObject({
      id: 'doc-cover-art',
      title: 'Cover Art',
      width: 800,
      height: 600,
      sourceBinItemId: 'cover-art',
      activeLayerId: null,
    });
    expect(doc.layers).toHaveLength(0);
  });

  it('describes source-bin image opens as quick-edit workflows with source links', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'source-bin-item',
      item: imageItem(),
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'quick-edit',
      mode: 'source-bin-document',
      sourceBinItemId: 'cover-art',
      sourceLabel: 'Cover Art',
      opensEditableDocument: true,
      keepsSourceLink: true,
      nativeRoundtrip: 'source-linked',
      warnings: [],
    });
  });

  it('describes local raster opens as export-only workflows without source side effects', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'local-file',
      fileName: 'Panel.png',
      mimeType: 'image/png',
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'export-only',
      mode: 'local-file-document',
      sourceBinItemId: undefined,
      sourceLabel: 'Panel.png',
      opensEditableDocument: true,
      keepsSourceLink: false,
      nativeRoundtrip: 'none',
      warnings: [],
    });
  });

  it('describes bounded XCF raster opens with native roundtrip warnings', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'local-file',
      fileName: 'Design.xcf',
      mimeType: 'image/x-xcf',
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'export-only',
      mode: 'local-file-document',
      opensEditableDocument: true,
      keepsSourceLink: false,
      nativeRoundtrip: 'none',
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([]);
  });

  it('describes Camera Raw opens as rejected develop-first workflows with format status', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'local-file',
      fileName: 'Capture.NEF',
      mimeType: 'image/x-nikon-nef',
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'export-only',
      mode: 'local-file-document',
      sourceLabel: 'Capture.NEF',
      formatLabel: 'Camera Raw',
      sourceMimeType: 'image/x-nikon-nef',
      sourceExtension: 'nef',
      importStatus: 'unsupported',
      opensEditableDocument: false,
      keepsSourceLink: false,
      nativeRoundtrip: 'unsupported',
      bitDepth: {
        status: 'not-decoded',
        sourceBitsPerChannel: 'camera-raw',
        editorBitsPerChannel: 8,
        browserDecodedTo: 'not decoded',
        preservesHighBitDepth: false,
      },
    });
    expect(descriptor.formatLimitations.join(' ')).toMatch(/RAW|demosaic|develop/i);
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(['raw-development-required']);
    expect(descriptor.warnings[0]).toMatchObject({
      code: 'raw-development-required',
      formatLabel: 'Camera Raw',
      sourceMimeType: 'image/x-nikon-nef',
      message: expect.stringMatching(/external|develop|RAW/i),
    });
    expect(descriptor.rawDevelopFirst).toMatchObject({
      sourceLabel: 'Capture.NEF',
      sourceMimeType: 'image/x-nikon-nef',
      sourceExtension: 'nef',
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      recommendedConversionPath: [
        'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
        'Export a fully developed derivative as 8-bit TIFF, PSD, PNG, JPEG before opening in Image.',
        'Open the exported file as a normal raster import target.',
      ],
      openAsPixelsBlockedReasons: [
        'Image has no RAW demosaic/development pipeline for camera sensor data.',
        'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
      ],
    });
  });

  it('detects source-linked RAW opens as explicit external-development-required workflows before decode', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'source-bin-item',
      item: {
        ...imageItem(),
        id: 'raw-camera',
        label: 'Capture.NEF',
        mimeType: 'image/x-nikon-nef',
      },
      bytes: new TextEncoder().encode('RAW raw bytes'),
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'quick-edit',
      mode: 'source-bin-document',
      sourceBinItemId: 'raw-camera',
      sourceLabel: 'Capture.NEF',
      sourceExtension: 'nef',
      sourceMimeType: 'image/x-nikon-nef',
      formatLabel: 'Camera Raw',
      importStatus: 'unsupported',
      opensEditableDocument: false,
      nativeRoundtrip: 'unsupported',
      keepsSourceLink: false,
    });
    expect(descriptor.formatLimitations.join(' ')).toMatch(/develop|external RAW|demosaic/i);
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(['raw-development-required']);
    expect(descriptor.warnings[0].message).toMatch(/external|develop|RAW/i);
    expect(descriptor.rawDevelopFirst).toMatchObject({
      sourceLabel: 'Capture.NEF',
      sourceMimeType: 'image/x-nikon-nef',
      sourceExtension: 'nef',
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      recommendedConversionPath: [
        'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
        'Export a fully developed derivative as 8-bit TIFF, PSD, PNG, JPEG before opening in Image.',
        'Open the exported file as a normal raster import target.',
      ],
      openAsPixelsBlockedReasons: [
        'Image has no RAW demosaic/development pipeline for camera sensor data.',
        'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
      ],
    });
  });

  it('summarizes source document roundtrip risk and suite caveats for RAW imports', () => {
    const descriptor = describeImageSourceDocumentRoundtripRisk({
      kind: 'source-bin-item',
      item: {
        ...imageItem(),
        id: 'raw-camera',
        label: 'Capture.NEF',
        mimeType: 'image/x-nikon-nef',
      },
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-source-document-roundtrip-risk:v1',
      workflowKind: 'quick-edit',
      mode: 'source-bin-document',
      sourceBinItemId: 'raw-camera',
      sourceLabel: 'Capture.NEF',
      formatLabel: 'Camera Raw',
      importStatus: 'unsupported',
      externalDevelopmentRequired: true,
      roundtripRisk: 'unsupported',
      unsupportedImportBlockers: ['raw-development-required'],
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      sourceDocumentCaveats: [
        'Camera Raw sources cannot open as editable Image documents until developed externally.',
        'No RAW demosaic, camera-profile, or non-destructive develop settings are preserved in Image source documents.',
      ],
      suiteHandoffCaveats: [
        'Hand off developed TIFF, PSD, PNG, or JPEG derivatives to Flow, Video, or Paper.',
        'Keep the RAW source as provenance only; Image edits target the developed derivative.',
      ],
      rawDevelopFirst: {
        sourceLabel: 'Capture.NEF',
        sourceMimeType: 'image/x-nikon-nef',
        sourceExtension: 'nef',
        supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
        recommendedConversionPath: [
          'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
          'Export a fully developed derivative as 8-bit TIFF, PSD, PNG, JPEG before opening in Image.',
          'Open the exported file as a normal raster import target.',
        ],
        openAsPixelsBlockedReasons: [
          'Image has no RAW demosaic/development pipeline for camera sensor data.',
          'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
        ],
      },
      previewSignature: 'image-source-document-roundtrip-risk:v1|mode=source-bin-document|source=raw-camera|format=Camera Raw|risk=unsupported|blockers=raw-development-required',
    });
  });

  it('describes source-bin PNG16 native ingress with a derived proxy', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'source-bin-item',
      item: {
        ...imageItem(),
        label: 'Grade plate.png',
        mimeType: 'image/png',
      },
      bytes: makePngHeader({ bitDepth: 16, colorType: 6 }),
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'quick-edit',
      mode: 'source-bin-document',
      sourceBinItemId: 'cover-art',
      sourceLabel: 'Grade plate.png',
      formatLabel: 'PNG',
      sourceMimeType: 'image/png',
      importStatus: 'supported',
      opensEditableDocument: true,
      keepsSourceLink: true,
      nativeRoundtrip: 'source-linked',
      bitDepth: {
        status: 'native-high-bit-supported',
        sourceBitsPerChannel: 16,
        editorBitsPerChannel: 16,
        browserDecodedTo: 'native u16/f32 PixelBuffer authority',
        preservesHighBitDepth: true,
      },
    });
    expect(descriptor.formatLimitations.join(' ')).toMatch(/PNG16.*native.*u16|u16.*authority/i);
    expect(descriptor.warnings).toEqual([]);
  });

  it('describes missing source-linked layer refreshes with missing source warnings', () => {
    const descriptor = describeImageSourceOpenWorkflow({
      kind: 'source-linked-layer',
      layer: {
        id: 'smart',
        name: 'Smart source',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: { width: 320, height: 180 } as LayerBitmap,
        bitmapVersion: 0,
        mask: null,
        metadata: {
          smartLinkedSourceId: 'cover-art',
          sourceLabel: 'Cover Art',
          sourceLink: {
            id: 'cover-art',
            label: 'Cover Art',
            width: 320,
            height: 180,
            status: 'missing',
            relinkHistory: [],
          },
        },
      },
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'source-linked',
      mode: 'source-linked-layer-refresh',
      sourceBinItemId: 'cover-art',
      sourceLabel: 'Cover Art',
      opensEditableDocument: false,
      keepsSourceLink: false,
      nativeRoundtrip: 'unsupported',
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(['missing-source-link']);
  });

  it('builds deterministic Source Library handoff descriptors for source-linked opened documents', () => {
    const doc = createSourceBackedImageDocumentShell(imageItem(), { fallbackWidth: 320, fallbackHeight: 180 });
    const descriptor = describeImageSourceLibraryHandoff({
      doc: {
        ...doc,
        layers: [
          {
            id: 'linked-layer',
            name: 'Linked plate',
            type: 'image',
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            x: 0,
            y: 0,
            bitmap: { width: 320, height: 180 } as LayerBitmap,
            bitmapVersion: 2,
            mask: null,
            metadata: {
              smartLinkedSourceId: 'cover-art',
              sourceLabel: 'Cover Art',
              sourceFormat: 'PNG',
            },
          },
          {
            id: 'generated-sky',
            name: 'Generated Sky',
            type: 'image',
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            x: 10,
            y: 20,
            bitmap: { width: 120, height: 80 } as LayerBitmap,
            bitmapVersion: 1,
            mask: null,
            metadata: { sourceFormat: 'generative-fill' },
          },
        ],
        snapshots: [
          {
            id: 'snap-2',
            name: 'After fill',
            createdAt: 20,
            width: 320,
            height: 180,
            layers: [],
            activeLayerId: 'generated-sky',
            hasSelection: false,
            selectionVersion: 0,
          },
          {
            id: 'snap-1',
            name: 'Opened source',
            createdAt: 10,
            width: 320,
            height: 180,
            layers: [],
            activeLayerId: 'linked-layer',
            hasSelection: false,
            selectionVersion: 0,
          },
        ],
      },
      sourceItems: [imageItem()],
    });

    expect(descriptor).toEqual({
      descriptorId: 'image-source-library-handoff:v1',
      documentId: 'doc-cover-art',
      documentTitle: 'Cover Art',
      documentState: 'source-linked-opened',
      source: {
        sourceBinItemId: 'cover-art',
        label: 'Cover Art',
        assetUrlKind: 'embedded-data-url',
        durableAsset: true,
        pixelWidth: null,
        pixelHeight: null,
      },
      readiness: {
        flow: { target: 'flow', ready: true, reason: 'Ready to send Source Library item "cover-art" to Flow.' },
        video: { target: 'video', ready: true, reason: 'Ready to send Source Library item "cover-art" to Video.' },
        paper: { target: 'paper', ready: true, reason: 'Ready to place Source Library item "cover-art" in Paper.' },
      },
      generatedSnapshots: [
        {
          layerId: 'generated-sky',
          layerName: 'Generated Sky',
          sourceFormat: 'generative-fill',
          bounds: { x: 10, y: 20, width: 120, height: 80 },
          sourceBinItemId: null,
        },
      ],
      referenceSnapshots: [
        {
          layerId: 'linked-layer',
          layerName: 'Linked plate',
          sourceFormat: 'PNG',
          bounds: { x: 0, y: 0, width: 320, height: 180 },
          sourceBinItemId: 'cover-art',
        },
      ],
      snapshots: [
        { id: 'snap-1', name: 'Opened source', createdAt: 10, width: 320, height: 180, layerCount: 0 },
        { id: 'snap-2', name: 'After fill', createdAt: 20, width: 320, height: 180, layerCount: 0 },
      ],
      warnings: [],
      preview: {
        id: 'image-source-library-preview:doc-cover-art:cover-art',
        label: 'Cover Art',
        sizeLabel: '320x180',
        sourceLabel: 'Cover Art',
      },
      layerHandoff: {
        generated: [
          {
            kind: 'generated',
            layerId: 'generated-sky',
            layerName: 'Generated Sky',
            sourceBinItemId: null,
            ready: false,
            blockerCodes: ['missing-source-id'],
            signature: 'image-source-library-layer-handoff:v1|kind=generated|layer=generated-sky|source=none|ready=false|blockers=missing-source-id',
            summary: 'Generated Sky needs a durable Source Library source before suite handoff.',
          },
        ],
        reference: [
          {
            kind: 'reference',
            layerId: 'linked-layer',
            layerName: 'Linked plate',
            sourceBinItemId: 'cover-art',
            ready: true,
            blockerCodes: [],
            signature: 'image-source-library-layer-handoff:v1|kind=reference|layer=linked-layer|source=cover-art|ready=true|blockers=none',
            summary: 'Linked plate can hand off Source Library item "cover-art".',
          },
        ],
        sourceLinked: [
          {
            kind: 'source-linked',
            layerId: 'linked-layer',
            layerName: 'Linked plate',
            sourceBinItemId: 'cover-art',
            ready: true,
            blockerCodes: [],
            signature: 'image-source-library-layer-handoff:v1|kind=source-linked|layer=linked-layer|source=cover-art|ready=true|blockers=none',
            summary: 'Linked plate can refresh from Source Library item "cover-art".',
          },
        ],
      },
      sourceSnapshotAvailability: {
        available: true,
        snapshotCount: 2,
        latestSnapshotId: 'snap-2',
        sourceIds: ['cover-art'],
        missingSourceIds: [],
      },
      externalAssetPackaging: {
        required: false,
        caveats: [],
        signature: 'image-source-library-external-asset-package:v1|source=cover-art|asset=embedded-data-url|durable=true|required=false',
      },
      suiteHandoffBlockers: [],
      sourceSnapshotRisk: {
        state: 'preserved',
        preservesSourceSnapshot: true,
        snapshotCount: 2,
        latestSnapshotId: 'snap-2',
        sourceIds: ['cover-art'],
        missingSourceIds: [],
        blobOnlySourceIds: [],
        blockerCodes: [],
        caveats: [],
        signature: 'image-source-library-source-snapshot-risk:v1|state=preserved|preserved=true|snapshots=2|latest=snap-2|sources=cover-art|missing=none|blobOnly=none|blockers=none',
      },
      sourceDocumentSignature: 'image-source-library-source-document:v1|document=doc-cover-art|state=source-linked-opened|source=cover-art|asset=embedded-data-url|durable=true|size=320x180',
      layerHandoffSignature: 'image-source-library-layer-handoff-set:v1|generated=image-source-library-layer-handoff:v1|kind=generated|layer=generated-sky|source=none|ready=false|blockers=missing-source-id|reference=image-source-library-layer-handoff:v1|kind=reference|layer=linked-layer|source=cover-art|ready=true|blockers=none|sourceLinked=image-source-library-layer-handoff:v1|kind=source-linked|layer=linked-layer|source=cover-art|ready=true|blockers=none',
      previewSignature: 'image-source-library-handoff:v1:{"documentId":"doc-cover-art","sourceId":"cover-art","documentState":"source-linked-opened","size":"320x180","layers":["generated-sky","linked-layer"],"snapshots":["snap-1","snap-2"],"warnings":[]}',
    });
  });

  it('warns when Source Library handoff has only blob-local or missing source durability', () => {
    const descriptor = describeImageSourceLibraryHandoff({
      doc: {
        ...createSourceBackedImageDocumentShell({ id: 'blob-source', label: 'Blob only' }),
        sourceBinItemId: 'blob-source',
      },
      sourceItems: [{
        ...imageItem(),
        id: 'blob-source',
        label: 'Blob only',
        assetUrl: 'blob:file:///tmp/generated-preview',
        assetId: undefined,
        scratchFileName: undefined,
        nativeFilePath: undefined,
      }],
    });

    expect(descriptor.documentState).toBe('source-linked-opened');
    expect(descriptor.source).toMatchObject({
      sourceBinItemId: 'blob-source',
      assetUrlKind: 'blob-url',
      durableAsset: false,
    });
    expect(descriptor.readiness.flow.ready).toBe(false);
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(['blob-only-source-url']);
    expect(descriptor.externalAssetPackaging).toEqual({
      required: true,
      caveats: ['Source Library item "blob-source" only has a blob URL; package it into project scratch or native media before cross-workspace handoff.'],
      signature: 'image-source-library-external-asset-package:v1|source=blob-source|asset=blob-url|durable=false|required=true',
    });
    expect(descriptor.sourceSnapshotRisk).toMatchObject({
      state: 'blob-only-risk',
      preservesSourceSnapshot: false,
      snapshotCount: 0,
      sourceIds: ['blob-source'],
      missingSourceIds: [],
      blobOnlySourceIds: ['blob-source'],
      blockerCodes: ['blob-only-source-url'],
    });
    expect(descriptor.sourceSnapshotRisk.signature).toBe(
      'image-source-library-source-snapshot-risk:v1|state=blob-only-risk|preserved=false|snapshots=0|latest=none|sources=blob-source|missing=none|blobOnly=blob-source|blockers=blob-only-source-url',
    );
    expect(descriptor.suiteHandoffBlockers).toEqual([
      {
        code: 'blob-only-source-url',
        target: 'suite',
        message: 'Persist Source Library item "blob-source" before Flow, Video, or Paper handoff.',
      },
    ]);

    const missing = describeImageSourceLibraryHandoff({
      doc: createSourceBackedImageDocumentShell({ id: 'missing-source', label: 'Missing source' }),
      sourceItems: [],
    });

    expect(missing.documentState).toBe('missing-source-id');
    expect(missing.readiness.paper.ready).toBe(false);
    expect(missing.warnings.map((warning) => warning.code)).toEqual(['missing-source-id']);
    expect(missing.sourceSnapshotAvailability).toMatchObject({
      available: false,
      snapshotCount: 0,
      sourceIds: [],
      missingSourceIds: ['missing-source'],
    });
    expect(missing.suiteHandoffBlockers.map((blocker) => blocker.code)).toEqual(['missing-source-id']);
  });

  it('loads source-bin image assets into an editable image layer when a bitmap is available', async () => {
    const bitmap = { width: 320, height: 180 } as LayerBitmap;
    const doc = await createImageDocumentFromSourceItem(imageItem(), {
      loadBitmap: async () => bitmap,
    });

    expect(doc).toMatchObject({
      id: 'doc-cover-art',
      title: 'Cover Art',
      width: 320,
      height: 180,
      activeLayerId: 'layer-cover-art',
      sourceBinItemId: 'cover-art',
    });
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]).toMatchObject({
      id: 'layer-cover-art',
      name: 'Cover Art',
      type: 'image',
      bitmap,
    });
    expect(doc.layers[0].metadata).toEqual({
      smartLinkedSourceId: 'cover-art',
      sourceLabel: 'Cover Art',
      sourceLink: {
        id: 'cover-art',
        label: 'Cover Art',
        width: 320,
        height: 180,
        status: 'linked',
        relinkHistory: [],
      },
    });
  });

  it('routes served LAN-session source opens through the authenticated host asset API', async () => {
    // In a phone-served browser session the synced item's assetUrl is a phone-local blob: URL the
    // desktop browser cannot fetch (the cause of the "NetworkError" open failure). The bytes must be
    // resolved through the host asset API by assetId instead.
    vi.mocked(isRemoteLanClient).mockReturnValue(true);
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-cover',
      name: 'Cover Art',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,HOSTRESOLVED',
    });

    const seenUrls: string[] = [];
    const bitmap = { width: 320, height: 180 } as LayerBitmap;
    const doc = await createImageDocumentFromSourceItem(
      {
        ...imageItem(),
        assetId: 'asset-cover',
        assetUrl: 'blob:http://192.168.1.50:8723/abc-phone-local',
      },
      {
        loadBitmap: async (url) => {
          seenUrls.push(url);
          return bitmap;
        },
      },
    );

    expect(loadImportedAssetAsDataUrl).toHaveBeenCalledWith('asset-cover');
    // The bitmap loaded from the host-resolved data URL, not the unreachable phone-local blob URL.
    expect(seenUrls).toEqual(['data:image/png;base64,HOSTRESOLVED']);
    expect(doc.layers[0].bitmap).toBe(bitmap);
  });

  it('refreshes source-linked layer bitmaps through the host asset API in served LAN sessions', async () => {
    vi.mocked(isRemoteLanClient).mockReturnValue(true);
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-cover',
      name: 'Cover Art',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,HOSTREFRESH',
    });

    const seenUrls: string[] = [];
    const bitmap = { width: 64, height: 64 } as LayerBitmap;
    await loadSourceLinkedLayerBitmap(
      { ...imageItem(), assetId: 'asset-cover', assetUrl: 'blob:http://192.168.1.50:8723/local' },
      async (url) => {
        seenUrls.push(url);
        return bitmap;
      },
    );

    expect(loadImportedAssetAsDataUrl).toHaveBeenCalledWith('asset-cover');
    expect(seenUrls).toEqual(['data:image/png;base64,HOSTREFRESH']);
  });

  it('opens native-file-backed served items via the host source-asset endpoint (no assetId)', async () => {
    // The failing real-world case: a phone item backed by a native file path carries no assetId, so it
    // could never resolve through /asset/:id. The host's /source-asset/:itemId endpoint resolves it by
    // source-item id through the universal loadItemAsDataUrl and hands back a same-origin data URL.
    vi.mocked(isRemoteLanClient).mockReturnValue(true);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockResolvedValue('data:image/png;base64,HOSTITEM');

    const seenUrls: string[] = [];
    const bitmap = { width: 200, height: 100 } as LayerBitmap;
    const doc = await createImageDocumentFromSourceItem(
      {
        ...imageItem(),
        assetId: undefined,
        nativeFilePath: '/storage/emulated/0/Pictures/cover.png',
        assetUrl: 'signal-loom-asset://native/cover.png',
      },
      {
        loadBitmap: async (url) => {
          seenUrls.push(url);
          return bitmap;
        },
      },
    );

    expect(fetchRemoteHostSourceAssetDataUrl).toHaveBeenCalledWith('cover-art');
    // Resolved purely by item id — the assetId-keyed IndexedDB path is never consulted.
    expect(loadImportedAssetAsDataUrl).not.toHaveBeenCalled();
    expect(seenUrls).toEqual(['data:image/png;base64,HOSTITEM']);
    expect(doc.layers[0].bitmap).toBe(bitmap);
  });

  it('refreshes native-file-backed served layers via the host source-asset endpoint', async () => {
    vi.mocked(isRemoteLanClient).mockReturnValue(true);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockResolvedValue('data:image/png;base64,HOSTITEMREFRESH');

    const seenUrls: string[] = [];
    const bitmap = { width: 64, height: 64 } as LayerBitmap;
    await loadSourceLinkedLayerBitmap(
      {
        ...imageItem(),
        assetId: undefined,
        nativeFilePath: '/storage/emulated/0/Pictures/cover.png',
        assetUrl: 'signal-loom-asset://native/cover.png',
      },
      async (url) => {
        seenUrls.push(url);
        return bitmap;
      },
    );

    expect(fetchRemoteHostSourceAssetDataUrl).toHaveBeenCalledWith('cover-art');
    expect(loadImportedAssetAsDataUrl).not.toHaveBeenCalled();
    expect(seenUrls).toEqual(['data:image/png;base64,HOSTITEMREFRESH']);
  });

  it('updates source-linked layer bitmaps while preserving transforms, masks, effects, and filters', () => {
    const replacement = { width: 640, height: 360 } as LayerBitmap;
    const mask = { width: 12, height: 12 } as LayerBitmap;
    const layer = {
      id: 'layer-cover-art',
      name: 'Panel placement',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 0.75,
      blendMode: 'multiply',
      x: 25,
      y: 40,
      rotationDeg: 15,
      bitmap: { width: 320, height: 180 } as LayerBitmap,
      bitmapVersion: 2,
      mask,
      effects: [{ id: 'fx-1', kind: 'stroke', enabled: true, color: '#fff', opacity: 1, size: 4, position: 'outside' }],
      filters: [{ id: 'filter-1', kind: 'blur', enabled: true, amount: 2, opacity: 1, blendMode: 'normal' }],
      metadata: { smartLinkedSourceId: 'cover-art', sourceLabel: 'Cover Art' },
    } satisfies ImageLayer;

    const updated = replaceSourceLinkedLayerBitmap(layer, { ...imageItem(), label: 'Cover Art v2' }, replacement);

    expect(updated.bitmap).toBe(replacement);
    expect(updated.bitmapVersion).toBe(3);
    expect(updated.x).toBe(25);
    expect(updated.y).toBe(40);
    expect(updated.rotationDeg).toBe(15);
    expect(updated.mask).toBe(mask);
    expect(updated.effects).toBe(layer.effects);
    expect(updated.filters).toBe(layer.filters);
    expect(updated.metadata).toEqual({
      smartLinkedSourceId: 'cover-art',
      sourceLabel: 'Cover Art v2',
      sourceLink: {
        id: 'cover-art',
        label: 'Cover Art v2',
        width: 640,
        height: 360,
        status: 'linked',
        relinkHistory: [],
      },
    });
  });

  it('records relink history when a smart layer is relinked to a new source', () => {
    const replacement = { width: 64, height: 64 } as LayerBitmap;
    const layer = {
      id: 'smart',
      name: 'Smart',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: { width: 32, height: 32 } as LayerBitmap,
      bitmapVersion: 0,
      mask: null,
      metadata: { smartLinkedSourceId: 'old', sourceLabel: 'Old', sourceLink: { id: 'old', label: 'Old', width: 32, height: 32, status: 'linked', relinkHistory: [] } },
    } satisfies ImageLayer;

    const updated = replaceSourceLinkedLayerBitmap(layer, { ...imageItem(), id: 'new', label: 'New' }, replacement);

    expect(updated.metadata?.sourceLink?.status).toBe('relinked');
    expect(updated.metadata?.sourceLink?.relinkHistory).toEqual([{ sourceId: 'old', label: 'Old', at: expect.any(Number) }]);
  });

  it('summarizes source-linked replacement and edit-original readiness with deterministic signatures', () => {
    const layer = {
      id: 'smart',
      name: 'Linked Cover',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 12,
      y: 18,
      bitmap: { width: 320, height: 180 } as LayerBitmap,
      bitmapVersion: 4,
      mask: null,
      filters: [{ id: 'filter-blur', kind: 'blur', enabled: true, amount: 2, opacity: 1, blendMode: 'normal' }],
      metadata: {
        smartLinkedSourceId: 'cover-art',
        sourceLabel: 'Cover Art',
        sourceFormat: 'PNG',
        sourceLink: {
          id: 'cover-art',
          label: 'Cover Art',
          width: 320,
          height: 180,
          status: 'relinked',
          relinkHistory: [{ sourceId: 'old-cover', label: 'Old Cover', at: 11 }],
        },
      },
    } satisfies ImageLayer;

    const descriptor = describeSourceLinkedLayerReadiness({
      layer,
      sourceItems: [{ ...imageItem(), assetId: 'asset-cover', pixelWidth: 320, pixelHeight: 180 }],
      snapshots: [{ id: 'snap-open', name: 'Opened source', createdAt: 10 }],
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-source-linked-layer-readiness:v1',
      layerId: 'smart',
      layerName: 'Linked Cover',
      status: 'linked',
      source: {
        sourceBinItemId: 'cover-art',
        label: 'Cover Art',
        formatLabel: 'PNG',
        linkStatus: 'relinked',
        relinkHistoryCount: 1,
        latestRelink: { sourceId: 'old-cover', label: 'Old Cover', at: 11 },
        assetAvailable: true,
        assetUrlKind: 'embedded-data-url',
        durableAsset: true,
        pixelWidth: 320,
        pixelHeight: 180,
      },
      replaceContents: {
        ready: true,
        mode: 'replace-linked-bitmap',
        preservesTransformMaskEffects: true,
        blockerCodes: [],
        caveats: ['Replacement updates the linked bitmap and metadata; it does not rewrite the original Source Library asset.'],
      },
      editOriginal: {
        ready: false,
        mode: 'metadata-only',
        caveat: 'Edit Original is metadata-only: Sloom Studio can identify the Source Library item, but does not launch or round-trip a native external editor.',
      },
      rasterize: {
        ready: true,
        mode: 'detach-source-link',
        preservesSourceLink: false,
        preservesSourceSnapshotHistory: true,
        caveats: [
          'Rasterize detaches the Source Library relationship and bakes the current linked pixels into the layer.',
          'Smart filters flatten into pixels when the source-linked layer is rasterized.',
        ],
      },
      sourceSnapshotPreservation: {
        preserved: true,
        snapshotCount: 1,
        latestSnapshotId: 'snap-open',
        sourceIds: ['cover-art'],
        missingSourceIds: [],
      },
      sourceSnapshotAvailability: {
        available: true,
        snapshotCount: 1,
        latestSnapshotId: 'snap-open',
        state: 'available',
      },
      relinkRepair: {
        ready: true,
        state: 'ready',
        blockerCodes: [],
        blockers: [],
      },
      smartFilters: {
        filterCount: 1,
        editableInHost: true,
        caveats: ['Smart filters are retained as Sloom Studio layer filters only; native Photoshop Smart Filter stacks are not round-tripped.'],
      },
      psdSmartObject: {
        supported: false,
        reason: 'PSD Smart Object payload editing and native embedded-object roundtrip are unsupported; this descriptor tracks Source Library links only.',
      },
      psdMetadataWarnings: [
        {
          code: 'metadata-only-psd-smart-object',
          message: 'PSD export keeps source-link planning metadata but writes flattened pixels instead of native Smart Object data.',
        },
        {
          code: 'metadata-only-smart-filters',
          message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
        },
      ],
      handoffReadiness: {
        sourceBin: {
          target: 'source-bin',
          ready: true,
          blockerCodes: [],
          caveats: [
            'Source Bin repair and replace workflows stay metadata-backed; they do not mutate the original Source Library asset bytes.',
          ],
        },
        video: {
          target: 'video',
          ready: true,
          blockerCodes: [],
          caveats: [
            'Video handoff receives flattened pixels plus Source Library provenance; native Smart Object editing is unavailable.',
            'Smart filters are flattened for Video handoff and PSD-native Smart Filter parity is unavailable.',
          ],
        },
      },
      actionSuitability: {
        replaceContents: {
          suitable: true,
          operation: 'replace-contents',
          blockerCodes: [],
          caveats: [
            'Replacement updates the linked bitmap and metadata; it does not rewrite the original Source Library asset.',
            'Smart filters are retained as Sloom Studio layer filters only; native Photoshop Smart Filter stacks are not round-tripped.',
          ],
        },
        relinkRepair: {
          suitable: true,
          operation: 'relink-repair',
          blockerCodes: [],
          caveats: ['Relink repair can run because the linked source is present, durable, and image-backed.'],
        },
        editOriginal: {
          suitable: false,
          operation: 'edit-original',
          blockerCodes: [],
          caveats: ['Edit Original is metadata-only: Sloom Studio can identify the Source Library item, but does not launch or round-trip a native external editor.'],
        },
      },
      batchSuitability: {
        suitable: true,
        operation: 'batch-replace-contents',
        blockerCodes: [],
        caveats: [
          'Batch replace is suitable for deterministic linked bitmap swaps; validate dimensions when relink history exists.',
          'Smart filters are retained as Sloom Studio layer filters only; native Photoshop Smart Filter stacks are not round-tripped.',
        ],
      },
      suiteHandoffSafe: true,
      standaloneState: {
        mode: 'standalone-quick-edit',
        quickOpenReady: true,
        quickSaveReady: true,
        quickExportReady: true,
        destructiveOverwriteWarning: 'required-before-source-overwrite',
        nativeExternalEditorRoundtrip: false,
        signedInstallerIdentityClaimed: false,
        blockerCodes: [],
        caveats: [
          'Save Over source-linked layers only after an explicit destructive overwrite confirmation.',
          'Edit Original is metadata-only and does not launch a native external editor.',
        ],
        signature: 'image-source-linked-layer-standalone:v1|layer=smart|source=cover-art|open=true|save=true|export=true|overwriteWarning=required-before-source-overwrite|blockers=none|nativeRoundtrip=false|signedIdentity=false',
      },
      suitePackage: {
        mode: 'source-library-package-handoff',
        ready: true,
        sourceLibraryPackageState: 'durable-source-library-asset',
        packagedSourceIds: ['cover-art'],
        missingSourceIds: [],
        blockerCodes: [],
        targets: {
          flow: {
            target: 'flow',
            ready: true,
            blockerCodes: [],
            caveats: [
              'Flow handoff uses the packaged Source Library asset plus flattened layer pixels; native Smart Object editing stays unavailable.',
            ],
          },
          video: {
            target: 'video',
            ready: true,
            blockerCodes: [],
            caveats: [
              'Video handoff uses flattened pixels plus packaged Source Library provenance; native Smart Object editing stays unavailable.',
            ],
          },
          paper: {
            target: 'paper',
            ready: true,
            blockerCodes: [],
            caveats: [
              'Paper handoff places flattened pixels while preserving packaged Source Library provenance for relink review.',
            ],
          },
        },
        caveats: [
          'Suite handoff packages the durable Source Library source beside flattened Image pixels and Sloom Studio metadata.',
        ],
        signature: 'image-source-linked-layer-suite-package:v1|layer=smart|source=cover-art|state=durable-source-library-asset|ready=true|packaged=cover-art|missing=none|blockers=none|targets=flow:true,video:true,paper:true',
      },
      warningCodes: [
        'metadata-only-psd-smart-object',
        'metadata-only-smart-filters',
        'relinked-source-dimensions-should-be-verified',
      ],
      previewSignature: 'image-source-linked-layer-readiness:v1:{"layerId":"smart","sourceId":"cover-art","linkStatus":"relinked","assetAvailable":true,"durableAsset":true,"replaceReady":true,"relinkReady":true,"rasterizeReady":true,"snapshotCount":1,"snapshotState":"available","preservedSnapshotId":"snap-open","filterCount":1,"blockers":[],"warningCodes":["metadata-only-psd-smart-object","metadata-only-smart-filters","relinked-source-dimensions-should-be-verified"],"handoff":{"sourceBin":true,"video":true},"standalone":"standalone-quick-edit:ready","suitePackage":"durable-source-library-asset:ready","refreshPolicy":"ready","batchSuitable":true}',
    });
  });

  it('keeps a local filter alpha grid in the source-linked readiness contract and scopes the PSD warning to native interchange', () => {
    const layer = {
      id: 'masked-smart',
      name: 'Masked smart layer',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: { width: 2, height: 1 } as LayerBitmap,
      bitmapVersion: 1,
      mask: null,
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
        smartLinkedSourceId: 'cover-art',
        sourceLabel: 'Cover Art',
        sourceLink: { id: 'cover-art', label: 'Cover Art', width: 2, height: 1, status: 'linked', relinkHistory: [] },
      },
    } satisfies ImageLayer;

    const descriptor = describeSourceLinkedLayerReadiness({
      layer,
      sourceItems: [{ ...imageItem(), assetId: 'asset-cover', pixelWidth: 2, pixelHeight: 1 }],
    });

    expect(descriptor.psdMetadataWarnings).toContainEqual({
      code: 'smart-filter-mask-unsupported',
      message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
    });
    expect(descriptor.warningCodes).toContain('smart-filter-mask-unsupported');
  });

  it('reports source-linked repair blockers for missing ids, missing assets, and blob-only sources', () => {
    const baseLayer = {
      id: 'missing-smart',
      name: 'Missing Smart',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: { width: 100, height: 100 } as LayerBitmap,
      bitmapVersion: 0,
      mask: null,
    } satisfies ImageLayer;

    const noId = describeSourceLinkedLayerReadiness({ layer: baseLayer });
    expect(noId.status).toBe('unlinked');
    expect(noId.replaceContents.ready).toBe(false);
    expect(noId.relinkRepair.blockerCodes).toEqual(['missing-source-id']);
    expect(noId.relinkRepair.state).toBe('needs-source-id');
    expect(noId.sourceSnapshotAvailability).toEqual({
      available: false,
      snapshotCount: 0,
      state: 'missing-source-id',
      caveat: 'Source snapshots require a durable Source Library id on the layer.',
    });
    expect(noId.sourceSnapshotPreservation).toEqual({
      preserved: false,
      snapshotCount: 0,
      sourceIds: [],
      missingSourceIds: [],
    });
    expect(noId.batchSuitability).toMatchObject({
      suitable: false,
      operation: 'batch-replace-contents',
      blockerCodes: ['missing-source-id'],
    });
    expect(noId.suiteHandoffSafe).toBe(false);

    const missingAsset = describeSourceLinkedLayerReadiness({
      layer: {
        ...baseLayer,
        metadata: {
          smartLinkedSourceId: 'gone',
          sourceLink: { id: 'gone', label: 'Gone', width: 100, height: 100, status: 'missing', relinkHistory: [] },
        },
      },
      sourceItems: [],
    });
    expect(missingAsset.status).toBe('missing');
    expect(missingAsset.relinkRepair.blockerCodes).toEqual(['missing-source-asset']);
    expect(missingAsset.relinkRepair.state).toBe('needs-source-asset');
    expect(missingAsset.handoffReadiness.video).toEqual({
      target: 'video',
      ready: false,
      blockerCodes: ['missing-source-asset'],
      caveats: ['Video handoff is blocked until the layer resolves to a durable image Source Library asset.'],
    });
    expect(missingAsset.previewSignature).toContain('"blockers":["missing-source-asset"]');

    const blobOnly = describeSourceLinkedLayerReadiness({
      layer: {
        ...baseLayer,
        metadata: {
          smartLinkedSourceId: 'blob-source',
          sourceLink: { id: 'blob-source', label: 'Blob Source', width: 100, height: 100, status: 'linked', relinkHistory: [] },
        },
      },
      sourceItems: [{ ...imageItem(), id: 'blob-source', label: 'Blob Source', assetUrl: 'blob:file:///tmp/source' }],
    });
    expect(blobOnly.status).toBe('blocked');
    expect(blobOnly.replaceContents.blockerCodes).toEqual(['blob-only-source-url']);
    expect(blobOnly.relinkRepair.state).toBe('needs-durable-asset');
    expect(blobOnly.relinkRepair.blockers).toEqual([
      'Source Library item "blob-source" only has a blob URL; persist it before replacement or suite handoff.',
    ]);
    expect(blobOnly.actionSuitability.replaceContents.suitable).toBe(false);
    expect(blobOnly.handoffReadiness.sourceBin.ready).toBe(false);
    expect(blobOnly.suiteHandoffSafe).toBe(false);
    expect(blobOnly.standaloneState).toMatchObject({
      mode: 'standalone-quick-edit',
      quickOpenReady: false,
      quickSaveReady: false,
      quickExportReady: true,
      destructiveOverwriteWarning: 'blocked-until-source-relinked',
      nativeExternalEditorRoundtrip: false,
      signedInstallerIdentityClaimed: false,
      blockerCodes: ['blob-only-source-url'],
    });
    expect(blobOnly.suitePackage).toMatchObject({
      mode: 'source-library-package-handoff',
      ready: false,
      sourceLibraryPackageState: 'blob-url-needs-packaging',
      packagedSourceIds: [],
      missingSourceIds: ['blob-source'],
      blockerCodes: ['blob-only-source-url'],
      targets: {
        flow: { target: 'flow', ready: false, blockerCodes: ['blob-only-source-url'] },
        video: { target: 'video', ready: false, blockerCodes: ['blob-only-source-url'] },
        paper: { target: 'paper', ready: false, blockerCodes: ['blob-only-source-url'] },
      },
    });
    expect(blobOnly.suitePackage.signature).toBe(
      'image-source-linked-layer-suite-package:v1|layer=missing-smart|source=blob-source|state=blob-url-needs-packaging|ready=false|packaged=none|missing=blob-source|blockers=blob-only-source-url|targets=flow:false,video:false,paper:false',
    );
  });

  it('adds explicit source-linked refresh blockers with stable signatures', () => {
    const layer = {
      id: 'refresh-smart',
      name: 'Refresh Smart',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: { width: 100, height: 100 } as LayerBitmap,
      bitmapVersion: 0,
      mask: null,
      metadata: {
        smartLinkedSourceId: 'missing-source',
        sourceLink: {
          id: 'missing-source',
          label: 'Missing Source',
          width: 100,
          height: 100,
          status: 'missing',
          relinkHistory: [],
        },
      },
    } satisfies ImageLayer;

    const descriptor = describeSourceLinkedLayerReadiness({
      layer,
      sourceItems: [],
    });

    expect(descriptor.refreshPolicy).toEqual({
      mode: 'source-linked-refresh',
      operation: 'refresh-linked-bitmap',
      ready: false,
      sourceBinItemId: 'missing-source',
      requiresRelink: true,
      destructiveSaveBlocked: true,
      blockerCodes: ['missing-source-asset'],
      blockers: [
        {
          code: 'missing-source-asset',
          sourceId: 'missing-source',
          message: 'Source Library item "missing-source" is missing or has no asset URL; refresh is blocked until it is relinked.',
        },
      ],
      signature: 'image-source-linked-layer-refresh-policy:v1|layer=refresh-smart|source=missing-source|ready=false|requiresRelink=true|destructiveSaveBlocked=true|blockers=missing-source-asset',
    });
    expect(descriptor.previewSignature).toContain('"refreshPolicy":"blocked:missing-source-asset"');
  });

  it('loads replacement bitmaps only from image source-bin items with asset URLs', async () => {
    const bitmap = { width: 640, height: 360 } as LayerBitmap;
    await expect(loadSourceLinkedLayerBitmap(imageItem(), async () => bitmap)).resolves.toBe(bitmap);
    await expect(loadSourceLinkedLayerBitmap({ ...imageItem(), assetUrl: undefined })).rejects.toThrow(
      /image Source Bin item/,
    );
  });

  it('opens a local raster file into a single editable layer document', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'Cover Panel.png', { type: 'image/png' });

    const doc = await createImageDocumentFromFile(file, { id: 'local-cover-panel' });

    expect(doc).toMatchObject({
      id: 'local-cover-panel',
      title: 'Cover Panel',
      width: 48,
      height: 27,
      activeLayerId: 'local-cover-panel-layer-0',
      metadata: { sourceMimeType: 'image/png' },
    });
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]).toMatchObject({
      id: 'local-cover-panel-layer-0',
      name: 'Cover Panel.png',
      type: 'image',
      metadata: {
        sourceLabel: 'Cover Panel.png',
        sourceMimeType: 'image/png',
      },
    });
  });

  it('rejects local PSD files through the generic image opener with a dedicated-open message', async () => {
    const psd = new File([new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1])], 'Layered.psd', {
      type: 'image/vnd.adobe.photoshop',
    });

    await expect(createImageDocumentFromFile(psd)).rejects.toThrow(/Open PSD control/);
  });

  it('rejects local Camera Raw files with a clear develop-first message', async () => {
    const raw = new File([new Uint8Array([0, 1, 2, 3])], 'Capture.NEF', {
      type: 'image/x-nikon-nef',
    });

    await expect(createImageDocumentFromFile(raw)).rejects.toThrow(/Camera Raw|RAW development|demosaic/i);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('opens PNG16 through native authority and derives its display proxy', async () => {
    const source = encodePng16Rgba({
      width: 2,
      height: 1,
      data: new Uint16Array([1000, 2000, 3000, 65535, 4000, 5000, 6000, 32768]),
    });
    const file = new File([copyToArrayBuffer(source)], 'Grade plate.png', { type: 'image/png' });
    const doc = await createImageDocumentFromFile(file, { id: 'local-grade-plate' });

    expect(doc.metadata).toMatchObject({ bitDepth: 16, sourceBitDepth: 16, warnings: [] });
    expect(doc.layers[0]).toMatchObject({ pixels: { width: 2, height: 1, depth: 'u16' }, bitmap: { width: 2, height: 1 } });
    expect(Array.from(doc.layers[0].pixels!.data as Uint16Array)).toEqual([1000, 2000, 3000, 65535, 4000, 5000, 6000, 32768]);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('keeps source-linked PNG16 ingress native even when a legacy bitmap loader is supplied', async () => {
    const bytes = encodePng16Rgba({ width: 1, height: 1, data: new Uint16Array([11, 22, 33, 65535]) });
    const loader = vi.fn(async () => new FakeOffscreenCanvas(1, 1) as unknown as LayerBitmap);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([copyToArrayBuffer(bytes)], { type: 'image/png' }),
    })));
    const item = { ...imageItem(), label: 'Linked plate.png', assetUrl: 'native://linked-plate.png' };
    const doc = await createImageDocumentFromSourceItem(item, { loadBitmap: loader });
    expect(doc.metadata?.bitDepth).toBe(16);
    expect(doc.layers[0].pixels?.data[0]).toBe(11);
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([
    ['TIFF16', 'scan.tif', 'image/tiff', encodeHighBitTiff({ width: 1, height: 1, depth: 'u16', data: new Uint16Array([11, 22, 33, 65535]) }), 16],
    ['TIFF32f', 'scan.tif', 'image/tiff', encodeHighBitTiff({ width: 1, height: 1, depth: 'f32', data: new Float32Array([0.1, 0.2, 0.3, 1]) }), 32],
    ['OpenEXR', 'scan.exr', 'image/x-exr', encodeExr({ width: 1, height: 1, depth: 'f32', data: new Float32Array([0.1, 0.2, 0.3, 1]) }), 32],
  ] as const)('opens %s through the normal native source path', async (_label, name, type, bytes, bitDepth) => {
    const file = new File([copyToArrayBuffer(bytes)], name, { type });
    const doc = await createImageDocumentFromFile(file, { id: `native-${name}` });
    expect(doc.metadata?.bitDepth).toBe(bitDepth);
    expect(doc.layers[0].pixels).toMatchObject({ width: 1, height: 1 });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('refuses malformed PNG16 before browser proxy fallback', async () => {
    const file = new File([copyToArrayBuffer(makePngHeader({ bitDepth: 16, colorType: 6 }))], 'Grade plate.png', {
      type: 'image/png',
    });

    await expect(createImageDocumentFromFile(file, { id: 'local-grade-plate' })).rejects.toThrow(/PNG decode refused/i);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });
});

describe('createImageDocumentFromClipboard', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    clearImageClipboard();
  });

  it('returns null when there is no clipboard image', async () => {
    const doc = await createImageDocumentFromClipboard();
    expect(doc).toBeNull();
  });

  it('builds a new document sized to the in-app clipboard image, layer at the origin', async () => {
    const layer: ImageLayer = {
      id: 'layer-src',
      name: 'Selection',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 17,
      y: 23,
      bitmap: new FakeOffscreenCanvas(80, 40) as unknown as LayerBitmap,
      bitmapVersion: 0,
      mask: null,
    };
    expect(copyLayerPixelsToClipboard({} as never, layer, null)).toBe(true);

    const doc = await createImageDocumentFromClipboard({ title: 'Pasted' });
    expect(doc).not.toBeNull();
    expect(doc?.width).toBe(80);
    expect(doc?.height).toBe(40);
    expect(doc?.layers).toHaveLength(1);
    expect(doc?.layers[0]).toMatchObject({ type: 'image', x: 0, y: 0 });
    expect(doc?.layers[0].bitmap?.width).toBe(80);
    expect(doc?.layers[0].bitmap?.height).toBe(40);
    expect(doc?.activeLayerId).toBe(doc?.layers[0].id);
    expect(doc?.title).toBe('Pasted');
  });
});

function makePngHeader(options: { bitDepth: number; colorType: number }): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  bytes[24] = options.bitDepth;
  bytes[25] = options.colorType;
  return bytes;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
