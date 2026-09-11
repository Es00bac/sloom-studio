import { beforeEach, describe, expect, it } from 'vitest';
import type { Layer as PsdLayer, Psd } from 'ag-psd';
import type { ImageDocument, ImageLayer, LayerBitmap, SmartSource } from '../../types/imageEditor';
import {
  IMAGE_PSD_MIME_TYPE,
  SIGNAL_LOOM_PSD_METADATA_KEY,
  buildPsdDocumentFromImageDocument,
  buildSignalLoomPsdNativeConstructReadiness,
  buildSignalLoomPsdRoundtripRiskDescriptor,
  imageDocumentToPsdBlob,
  detectPhotoshopDocumentKind,
  psdDocumentToImageDocument,
  psdArrayBufferToImageDocument,
  readSignalLoomPsdMetadata,
} from './ImagePsdInterop';
import type { SmartObjectPsdRecord } from './smartObjects/SmartObjectPsd';
import { withSmartObjectPsdBridges } from './smartObjects/SmartObjectC1C3Adapter';

class FakeContext {
  imageData: ImageData;
  private translateX = 0;
  private translateY = 0;
  private stack: Array<{ x: number; y: number }> = [];

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }

  getImageData(_x?: number, _y?: number, width = this.imageData.width, height = this.imageData.height) {
    void _x;
    void _y;
    return cloneImageData({
      width,
      height,
      data: this.imageData.data.slice(0, width * height * 4),
    } as ImageData);
  }

  putImageData(imageData: ImageData) {
    this.imageData = cloneImageData(imageData);
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  drawImage(source: unknown, dx = 0, dy = 0) {
    const sourceData = (source as { context?: FakeContext }).context?.imageData;
    if (!sourceData) return;
    for (let y = 0; y < sourceData.height; y += 1) {
      for (let x = 0; x < sourceData.width; x += 1) {
        const targetX = Math.round(this.translateX + dx + x);
        const targetY = Math.round(this.translateY + dy + y);
        if (targetX < 0 || targetY < 0 || targetX >= this.imageData.width || targetY >= this.imageData.height) {
          continue;
        }
        const sourceOffset = (y * sourceData.width + x) * 4;
        const targetOffset = (targetY * this.imageData.width + targetX) * 4;
        this.imageData.data[targetOffset] = sourceData.data[sourceOffset];
        this.imageData.data[targetOffset + 1] = sourceData.data[sourceOffset + 1];
        this.imageData.data[targetOffset + 2] = sourceData.data[sourceOffset + 2];
        this.imageData.data[targetOffset + 3] = sourceData.data[sourceOffset + 3];
      }
    }
  }

  save() {
    this.stack.push({ x: this.translateX, y: this.translateY });
  }
  restore() {
    const next = this.stack.pop();
    if (!next) return;
    this.translateX = next.x;
    this.translateY = next.y;
  }
  translate(x = 0, y = 0) {
    this.translateX += x;
    this.translateY += y;
  }
  rotate() {}
  scale() {}
  transform() {}
  setTransform() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  clip() {}
  fillRect() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob(options?: { type?: string }) {
    return new Blob([this.context.imageData.data], { type: options?.type ?? 'image/png' });
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeImageData(width: number, height: number, fill?: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = fill[0];
      data[offset + 1] = fill[1];
      data[offset + 2] = fill[2];
      data[offset + 3] = fill[3];
    }
  }
  return { width, height, data } as ImageData;
}

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function makeBitmap(width: number, height: number, fill: [number, number, number, number]): LayerBitmap {
  const bitmap = new OffscreenCanvas(width, height) as LayerBitmap;
  bitmap.getContext('2d')?.putImageData(makeImageData(width, height, fill), 0, 0);
  return bitmap;
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-psd',
    title: 'Storyboard Comp',
    width: 10,
    height: 8,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: makeBitmap(2, 2, [12, 34, 56, 255]),
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('ImagePsdInterop', () => {
  it('refuses 16/32-bit PSD headers before ag-psd can flatten them', () => {
    const header = new Uint8Array(26);
    header.set([0x38, 0x42, 0x50, 0x53, 0, 1], 0);
    header[12] = 0; header[13] = 4;
    header[14] = 0; header[17] = 1;
    header[18] = 0; header[21] = 1;
    header[24] = 0; header[25] = 3;
    header[22] = 0; header[23] = 16;
    expect(() => psdArrayBufferToImageDocument(header.buffer, { id: 'high-bit-psd', title: 'High bit PSD' }))
      .toThrow(/16-bit.*PSD.*refused before mutation|high-bit.*PSD/i);
  });
  beforeEach(() => {
    installCanvasStub();
  });

  it('exports Sloom Studio raster layers into a PSD layer stack', () => {
    const bottom = makeLayer({
      id: 'bottom',
      name: 'Background Plate',
      x: 1,
      y: 2,
      blendMode: 'multiply',
      bitmap: makeBitmap(3, 2, [255, 0, 0, 255]),
    });
    const top = makeLayer({
      id: 'top',
      name: 'Character Paint',
      visible: false,
      opacity: 0.5,
      blendMode: 'screen',
      x: 4,
      y: 1,
      bitmap: makeBitmap(2, 3, [0, 0, 255, 128]),
    });

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [bottom, top] }));

    expect(psd.width).toBe(10);
    expect(psd.height).toBe(8);
    expect(psd.children?.map((layer) => layer.name)).toEqual(['Character Paint', 'Background Plate']);
    expect(psd.children?.[0]).toMatchObject({
      left: 4,
      top: 1,
      right: 6,
      bottom: 4,
      opacity: 0.5,
      hidden: true,
      blendMode: 'screen',
    });
    expect(psd.children?.[1]).toMatchObject({
      left: 1,
      top: 2,
      right: 4,
      bottom: 4,
      opacity: 1,
      hidden: false,
      blendMode: 'multiply',
    });
    expect(psd.children?.[1].imageData?.data[0]).toBe(255);
    expect(readSignalLoomPsdMetadata(psd).layers.map((layer) => layer.name)).toEqual(['Background Plate', 'Character Paint']);
  });

  it('writes a C3 Smart Object bridge as a native placed layer with linked source bytes', () => {
    const smartObjectPsd: SmartObjectPsdRecord = {
      source: {
        id: '20953ddb-9391-11ec-b4f1-c15674f50bc4',
        name: 'embedded-source.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      },
      placement: {
        transform: [1, 2, 21, 2, 21, 22, 1, 22],
        width: 20,
        height: 20,
      },
      filters: [{ kind: 'box-blur', radius: 2 }],
    };
    const layer = makeLayer({ name: 'Embedded Smart Object' }) as ImageLayer & { smartObjectPsd: SmartObjectPsdRecord };
    layer.smartObjectPsd = smartObjectPsd;

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [layer] }));

    expect(psd.children?.[0]?.placedLayer).toMatchObject({
      type: 'raster',
      transform: smartObjectPsd.placement.transform,
      width: 20,
      height: 20,
      filter: { list: [{ type: 'box blur', filter: { radius: { value: 2, units: 'Pixels' } } }] },
    });
    expect(psd.linkedFiles).toHaveLength(1);
    expect(psd.linkedFiles?.[0]?.data).toEqual(smartObjectPsd.source.bytes);

    const imported = psdDocumentToImageDocument(psd, { id: 'imported-smart-object', title: 'Imported' });
    const importedBridge = (imported.layers[0] as ImageLayer & {
      smartObjectPsd?: SmartObjectPsdRecord;
    }).smartObjectPsd;
    expect(importedBridge?.source.bytes).toEqual(smartObjectPsd.source.bytes);
    expect(importedBridge?.placement.transform).toEqual(smartObjectPsd.placement.transform);
  });

  it('exports C1 duplicate instances as one C3 linked identity without changing C1 placements', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source: SmartSource = {
      id: 'c1-source', kind: 'embedded', mimeType: 'image/png', byteLength: bytes.byteLength,
      sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: 'C1 plate', version: 1,
      embeddedBytes: bytes,
    };
    const smartLayer = makeLayer({
      id: 'c1-instance', x: 3, y: 4,
      smartObject: { sourceId: source.id, placement: { width: 20, height: 10 }, renderedVersion: 1 },
    });
    const duplicate = makeLayer({
      id: 'c1-instance-duplicate', x: 30, y: 40,
      smartObject: { sourceId: source.id, placement: { width: 5, height: 6 }, renderedVersion: 1 },
    });
    const c1Document = makeDoc({ layers: [smartLayer, duplicate], metadata: { smartSources: { [source.id]: source } } });
    const exportView = withSmartObjectPsdBridges(c1Document);
    const psd = buildPsdDocumentFromImageDocument(exportView);

    expect(exportView.layers[0]?.smartObject).toEqual(smartLayer.smartObject);
    expect(exportView.layers[1]?.smartObject).toEqual(duplicate.smartObject);
    expect(psd.linkedFiles).toHaveLength(1);
    expect(psd.linkedFiles?.[0]).toMatchObject({ id: 'c1ce0000-0000-0000-0000-000000000000', name: source.label, type: source.mimeType, data: bytes });
    expect(psd.children?.map((child) => child.placedLayer?.id)).toEqual([
      'c1ce0000-0000-0000-0000-000000000000',
      'c1ce0000-0000-0000-0000-000000000000',
    ]);
    expect(psd.children?.map((child) => child.placedLayer?.transform)).toEqual(expect.arrayContaining([
      [3, 4, 23, 4, 23, 14, 3, 14],
      [30, 40, 35, 40, 35, 46, 30, 46],
    ]));
  });

  it('writes a bounded retained text layer as a native editable PSD text record and imports it without Sloom metadata', async () => {
    const caption = makeLayer({
      id: 'caption',
      name: 'Editable caption',
      type: 'text',
      x: 3,
      y: 2,
      bitmap: makeBitmap(8, 4, [20, 40, 80, 255]),
      text: {
        content: 'Native PSD',
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 24,
        fontWeight: '700',
        fontStyle: 'italic',
        fontKerning: 'auto',
        fontVariantCaps: 'small-caps',
        letterSpacing: 1.2,
        baselineShift: 2,
        boxWidth: 160,
        boxHeight: 48,
        wrap: true,
        color: '#336699',
        lineHeight: 1.25,
        align: 'center',
        verticalAlign: 'top',
        warp: 'none',
      },
    });
    const source = makeDoc({ layers: [caption] });
    const model = buildPsdDocumentFromImageDocument(source);

    expect(model.children?.[0]?.text).toMatchObject({
      text: 'Native PSD',
      orientation: 'horizontal',
      shapeType: 'box',
      style: {
        font: { name: 'Inter' },
        fontSize: 24,
        fauxBold: true,
        fauxItalic: true,
        fillColor: { r: 51, g: 102, b: 153 },
      },
      paragraphStyle: { justification: 'center' },
    });
    expect(readSignalLoomPsdMetadata(model).exportManifest?.compatibility.nativeEditableText).toBe(true);
    expect(readSignalLoomPsdMetadata(model).exportManifest?.layers[0]).toMatchObject({
      exportMode: 'native-text',
      flattened: false,
      text: { nativePsdTextLayer: true, metadataOnly: false },
    });

    const bytes = await (await imageDocumentToPsdBlob(source)).arrayBuffer();
    const imported = psdArrayBufferToImageDocument(bytes, { id: 'native-text', title: 'Native Text' });
    expect(imported.layers[0]).toMatchObject({
      name: 'Editable caption',
      type: 'text',
      x: 3,
      y: 2,
      metadata: { editableText: true },
      text: {
        content: 'Native PSD',
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: '700',
        fontStyle: 'italic',
        fontVariantCaps: 'small-caps',
        color: '#336699',
        boxWidth: 160,
        boxHeight: 48,
        wrap: true,
        align: 'center',
        warp: 'none',
      },
    });
  });

  it('keeps native PSD text records out of unsupported retained text and records the raster fallback reason', () => {
    const warped = makeLayer({
      id: 'warped',
      name: 'Warped title',
      type: 'text',
      text: {
        content: 'Arc title',
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: '400',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: null,
        boxHeight: null,
        wrap: false,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'left',
        verticalAlign: 'top',
        warp: 'arc',
      },
    });
    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [warped] }));
    const manifest = readSignalLoomPsdMetadata(psd).exportManifest;

    expect(psd.children?.[0]?.text).toBeUndefined();
    expect(manifest?.layers[0]).toMatchObject({
      exportMode: 'flattened-raster',
      flattened: true,
      text: {
        nativePsdTextLayer: false,
        metadataOnly: true,
        fallbackReason: 'Text warp is raster fallback only.',
      },
      warningCodes: ['editable-text-layer'],
    });
    expect(manifest?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'editable-text-layer', nativePsdTextLayer: false }),
    ]));
  });

  it('exports Sloom Studio group layers as native PSD folders with nested children', () => {
    const group = makeLayer({
      id: 'group-1',
      name: 'Scene Group',
      type: 'group',
      bitmap: null,
      groupExpanded: false,
    });
    const groupedPaint = makeLayer({
      id: 'paint-1',
      name: 'Grouped Paint',
      groupId: 'group-1',
      bitmap: makeBitmap(3, 2, [32, 64, 128, 255]),
    });
    const top = makeLayer({
      id: 'top',
      name: 'Top Loose Layer',
      bitmap: makeBitmap(2, 2, [255, 255, 0, 255]),
    });

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [group, groupedPaint, top] }));
    const metadata = readSignalLoomPsdMetadata(psd);
    const manifest = metadata.exportManifest;

    expect(psd.children?.map((layer) => layer.name)).toEqual(['Top Loose Layer', 'Scene Group']);
    const exportedGroup = psd.children?.find((layer) => layer.name === 'Scene Group');
    expect(exportedGroup).toMatchObject({
      hidden: false,
      opened: false,
    });
    expect(exportedGroup?.children?.map((layer) => layer.name)).toEqual(['Grouped Paint']);
    expect(exportedGroup?.children?.[0]?.imageData?.width).toBe(3);
    expect(manifest?.compatibility.nativeLayerGroups).toBe(true);
    expect(manifest?.warnings.map((warning) => warning.code)).not.toContain('layer-group');
    expect(manifest?.layers.find((layer) => layer.id === 'group-1')).toMatchObject({
      exportMode: 'native-group',
      metadataOnly: false,
      flattened: false,
      psdChildIndex: expect.any(Number),
      group: {
        childLayerIds: ['paint-1'],
        expanded: false,
        metadataOnly: false,
        nativePsdGroup: true,
      },
    });
  });

  it('imports native PSD folders as Sloom Studio group layers with child membership', () => {
    const psd: Psd = {
      width: 8,
      height: 8,
      children: [
        {
          name: 'Loose Top',
          left: 3,
          top: 1,
          right: 5,
          bottom: 3,
          imageData: makeImageData(2, 2, [200, 50, 50, 255]),
        },
        {
          name: 'Imported Folder',
          hidden: false,
          opened: false,
          children: [
            {
              name: 'Folder Paint',
              left: 1,
              top: 2,
              right: 4,
              bottom: 4,
              imageData: makeImageData(3, 2, [20, 80, 140, 255]),
            },
          ],
        },
      ],
    };

    const doc = psdDocumentToImageDocument(psd, { id: 'native-folder', title: 'Native Folder' });

    expect(doc.layers.map((layer) => ({ name: layer.name, type: layer.type, groupId: layer.groupId }))).toEqual([
      { name: 'Imported Folder', type: 'group', groupId: undefined },
      { name: 'Folder Paint', type: 'image', groupId: doc.layers[0].id },
      { name: 'Loose Top', type: 'image', groupId: undefined },
    ]);
    expect(doc.layers[0]).toMatchObject({
      name: 'Imported Folder',
      type: 'group',
      groupExpanded: false,
      bitmap: null,
    });
    expect(doc.layers[1]).toMatchObject({
      name: 'Folder Paint',
      x: 1,
      y: 2,
    });
  });

  it('preserves Sloom Studio text, source-link, and adjustment metadata on PSD model roundtrip', () => {
    const textLayer = makeLayer({
      id: 'text',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Hello',
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: '700',
        fontStyle: 'italic',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 1,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 60,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'arc',
      },
      metadata: { editableText: true, smartLinkedSourceId: 'src-1', sourceLabel: 'Panel', sourceLink: { id: 'src-1', label: 'Panel', width: 2, height: 2, status: 'linked', relinkHistory: [] } },
    });
    const adjustment = makeLayer({
      id: 'adjust',
      name: 'Blue Curve',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'curves', channel: 'blue', points: [{ input: 0, output: 0 }, { input: 128, output: 180 }, { input: 255, output: 255 }], shadows: 0, midtones: 0, highlights: 0 },
    });
    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [textLayer, adjustment] }));

    expect((psd as unknown as Record<string, unknown>)[SIGNAL_LOOM_PSD_METADATA_KEY]).toBeTruthy();
    const imported = psdDocumentToImageDocument(psd, { id: 'roundtrip', title: 'Roundtrip' });
    expect(imported.layers[0].text?.boxWidth).toBe(120);
    expect(imported.layers[0].metadata?.sourceLink?.status).toBe('linked');
    expect(readSignalLoomPsdMetadata(psd).layers[1].adjustment).toMatchObject({ kind: 'curves', channel: 'blue' });
  });

  it('roundtrips source relink history, retained typography, and layer effects through PSD metadata', () => {
    const relinkHistory = [
      { sourceId: 'src-original', label: 'Original panel', at: 1710000000000 },
      { sourceId: 'src-relinked', label: 'Relinked panel', at: 1710000100000 },
    ];
    const effects: NonNullable<ImageLayer['effects']> = [
      { id: 'fx-inner', kind: 'innerShadow', enabled: true, color: '#112233', opacity: 0.6, angle: 120, distance: 8, size: 6 },
      { id: 'fx-stroke', kind: 'stroke', enabled: true, color: '#ffffff', opacity: 0.9, size: 3, position: 'outside' },
    ];
    const textLayer = makeLayer({
      id: 'caption',
      name: 'Retained Caption',
      type: 'text',
      text: {
        content: 'Relinked caption',
        fontFamily: 'Inter',
        fontSize: 31,
        fontWeight: '800',
        fontStyle: 'italic',
        fontKerning: 'normal',
        fontVariantCaps: 'small-caps',
        letterSpacing: 2.5,
        baselineShift: 7,
        boxWidth: 180,
        boxHeight: 72,
        wrap: true,
        color: '#ffeeaa',
        lineHeight: 1.35,
        align: 'right',
        verticalAlign: 'bottom',
        warp: 'arc',
      },
      effects,
      metadata: {
        editableText: true,
        smartLinkedSourceId: 'src-current',
        sourceLabel: 'Current panel',
        sourceLink: {
          id: 'src-current',
          label: 'Current panel',
          width: 2048,
          height: 1536,
          status: 'relinked',
          relinkHistory,
        },
      },
    });

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [textLayer] }));
    const storedLayer = readSignalLoomPsdMetadata(psd).layers[0] as Pick<ImageLayer, 'text' | 'metadata' | 'effects'>;
    const imported = psdDocumentToImageDocument(psd, { id: 'roundtrip-rich', title: 'Roundtrip Rich' });

    expect(storedLayer.text).toMatchObject({
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      baselineShift: 7,
      letterSpacing: 2.5,
    });
    expect(storedLayer.effects).toEqual(effects);
    expect(storedLayer.metadata?.sourceLink).toEqual({
      id: 'src-current',
      label: 'Current panel',
      width: 2048,
      height: 1536,
      status: 'relinked',
      relinkHistory,
    });
    expect(imported.layers[0].text).toMatchObject({
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      baselineShift: 7,
      letterSpacing: 2.5,
    });
    expect(imported.layers[0].effects).toEqual(effects);
    expect(imported.layers[0].metadata?.sourceLink).toEqual(storedLayer.metadata?.sourceLink);
  });

  it('records explicit metadata-only warnings for unsupported native PSD smart object semantics', () => {
    const smartLayer = makeLayer({
      name: 'Linked Source Placement',
      metadata: {
        smartLinkedSourceId: 'source-art',
        sourceLabel: 'Source Art',
        sourceLink: {
          id: 'source-art',
          label: 'Source Art',
          width: 640,
          height: 480,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [smartLayer] }));
    const metadata = readSignalLoomPsdMetadata(psd) as ReturnType<typeof readSignalLoomPsdMetadata> & {
      unsupportedNativeConstructs?: Array<{
        code: string;
        nativePsdSmartObject: boolean;
        flattened: boolean;
        message: string;
      }>;
    };

    expect(metadata.unsupportedNativeConstructs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'native-smart-object',
        nativePsdSmartObject: false,
        flattened: true,
      }),
    ]));
    expect(metadata.unsupportedNativeConstructs?.[0]?.message).toMatch(/metadata-only/i);
    expect(metadata.unsupportedNativeConstructs?.[0]?.message).toMatch(/flattened/i);
  });

  it('adds bounded source-link status metadata for legacy smart-linked layers during PSD export', () => {
    const legacySmartLayer = makeLayer({
      name: 'Legacy Linked Placement',
      metadata: {
        smartLinkedSourceId: 'legacy-source',
        sourceLabel: 'Legacy Source',
      },
    });

    const psd = buildPsdDocumentFromImageDocument(makeDoc({ layers: [legacySmartLayer] }));
    const storedLayer = readSignalLoomPsdMetadata(psd).layers[0];

    expect(storedLayer.metadata?.sourceLink).toEqual({
      id: 'legacy-source',
      label: 'Legacy Source',
      width: 2,
      height: 2,
      status: 'linked',
      relinkHistory: [],
    });
  });

  it('attaches a deterministic export manifest for PSD compatibility gaps', () => {
    type PsdManifestLayerForTest = {
      id: string;
      name: string;
      type: ImageLayer['type'];
      exportMode: string;
      flattened: boolean;
      metadataOnly: boolean;
      psdChildIndex: number | null;
      groupId?: string;
      group?: {
        childLayerIds: string[];
        expanded: boolean;
        metadataOnly: boolean;
        nativePsdGroup: boolean;
      };
      text?: {
        contentLength: number;
        fontFamily?: string;
        fontSize?: number;
        metadataOnly: boolean;
        nativePsdTextLayer: boolean;
      };
      effects?: {
        count: number;
        kinds: string[];
        enabledKinds: string[];
        flattened: boolean;
        nativePsdLayerEffects: boolean;
      };
      mask?: {
        width: number;
        height: number;
        density?: number;
        feather?: number;
        flattened: boolean;
        nativePsdLayerMask: boolean;
      };
        sourceLink?: {
        id: string;
        label?: string;
        width?: number;
        height?: number;
        status: string;
        relinkCount: number;
        metadataOnly: boolean;
        nativePsdSmartObject: boolean;
        statusSummary?: {
          state: string;
          missing: boolean;
          repairRequired: boolean;
        };
        historySummary?: {
          relinkCount: number;
          lastRelinkAt?: number;
          lastSourceId?: string;
        };
        warnings?: Array<{ code: string; message: string }>;
        preview?: {
          layerBounds: { x: number; y: number; width: number; height: number };
          sourceDimensions?: { width: number; height: number };
        };
        previewSignature?: string;
        sourceSnapshotPreservation?: {
          preserved: boolean;
          snapshotId?: string;
          layerCount: number;
          sourceIds: string[];
          missingSourceIds: string[];
        };
        smartFilters?: {
          filterCount: number;
          enabledFilterCount: number;
          nativePsdSmartFilters: boolean;
          limitationWarnings: Array<{ code: string; message: string }>;
          previewSignature: string;
        };
        roundtripSummary?: {
          canRoundtripMetadata: boolean;
          nativePsdSmartObject: boolean;
          metadataOnlyPsdSmartObject: boolean;
          sourceId: string;
          status: string;
          relinkCount: number;
          warningCodes: string[];
        };
      };
    };
    type PsdManifestForTest = {
      kind: string;
      summary: Record<string, number>;
      compatibility: Record<string, unknown>;
      layers: PsdManifestLayerForTest[];
    };

    const group = makeLayer({
      id: 'group-1',
      name: 'Scene Group',
      type: 'group',
      bitmap: null,
      groupExpanded: false,
    });
    const linkedMaskedPaint = makeLayer({
      id: 'paint-1',
      name: 'Linked Masked Paint',
      groupId: 'group-1',
      mask: makeBitmap(2, 2, [255, 255, 255, 255]),
      maskDensity: 0.72,
      maskFeather: 1.5,
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 135, distance: 7, size: 9 },
      ],
      filters: [
        {
          id: 'filter-blur',
          kind: 'blur',
          enabled: true,
          amount: 5,
          opacity: 0.8,
          blendMode: 'normal',
          mask: { width: 2, height: 1, alpha: [0, 255] },
        },
      ],
      metadata: {
        smartLinkedSourceId: 'source-art',
        sourceLabel: 'Source Art',
        sourceLink: {
          id: 'source-art',
          label: 'Source Art',
          width: 640,
          height: 480,
          status: 'missing',
          relinkHistory: [{ sourceId: 'source-old', label: 'Old Source', at: 1710000000000 }],
        },
      },
    });
    const caption = makeLayer({
      id: 'caption-1',
      name: 'Caption Type',
      type: 'text',
      text: {
        content: 'Caption',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
    });
    const adjustment = makeLayer({
      id: 'adjust-1',
      name: 'Print Curve',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'levels', channel: 'rgb', inputBlack: 8, inputWhite: 245, gamma: 1, outputBlack: 0, outputWhite: 255 },
    });
    const doc = makeDoc({ layers: [group, linkedMaskedPaint, caption, adjustment] });

    const metadata = readSignalLoomPsdMetadata(buildPsdDocumentFromImageDocument(doc)) as ReturnType<typeof readSignalLoomPsdMetadata> & {
      exportManifest?: PsdManifestForTest;
    };
    const secondMetadata = readSignalLoomPsdMetadata(buildPsdDocumentFromImageDocument(doc)) as ReturnType<typeof readSignalLoomPsdMetadata> & {
      exportManifest?: PsdManifestForTest;
    };

    expect(metadata.exportManifest).toMatchObject({
      kind: 'signal-loom-psd-export-manifest',
      summary: {
        layerCount: 4,
        exportedPixelLayerCount: 2,
        groupCount: 1,
        textLayerCount: 1,
        effectLayerCount: 1,
        maskLayerCount: 1,
        sourceLinkedLayerCount: 1,
        metadataOnlyLayerCount: 1,
      },
      compatibility: {
        layerOrder: 'bottom-to-top',
        psdLayerOrder: 'top-to-bottom',
        nativeLayerGroups: true,
        nativeEditableText: true,
        nativeLayerEffects: false,
        nativeLayerMasks: true,
        nativeSmartObjects: false,
      },
    });
    expect(metadata.unsupportedNativeConstructs.map((warning) => warning.code)).toEqual([
      'native-smart-object',
      'adjustment-layer',
      'layer-effects',
    ]);
    expect(metadata.exportManifest?.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      exportMode: layer.exportMode,
      flattened: layer.flattened,
      metadataOnly: layer.metadataOnly,
      psdChildIndex: layer.psdChildIndex,
      groupId: layer.groupId,
      group: layer.group,
      text: layer.text,
      effects: layer.effects,
      mask: layer.mask,
      sourceLink: layer.sourceLink,
    }))).toEqual([
      {
        id: 'group-1',
        name: 'Scene Group',
        type: 'group',
        exportMode: 'native-group',
        flattened: false,
        metadataOnly: false,
        psdChildIndex: expect.any(Number),
        groupId: undefined,
        group: {
          childLayerIds: ['paint-1'],
          expanded: false,
          metadataOnly: false,
          nativePsdGroup: true,
        },
        text: undefined,
        effects: undefined,
        mask: undefined,
        sourceLink: undefined,
      },
      {
        id: 'paint-1',
        name: 'Linked Masked Paint',
        type: 'image',
        exportMode: 'flattened-raster',
        flattened: true,
        metadataOnly: false,
        psdChildIndex: 1,
        groupId: 'group-1',
        group: undefined,
        text: undefined,
        effects: {
          count: 1,
          kinds: ['dropShadow'],
          enabledKinds: ['dropShadow'],
          flattened: true,
          nativePsdLayerEffects: false,
        },
        mask: {
          width: 2,
          height: 2,
          density: 0.72,
          feather: 1.5,
            flattened: false,
            nativePsdLayerMask: true,
        },
        sourceLink: {
          id: 'source-art',
          label: 'Source Art',
          width: 640,
          height: 480,
          status: 'missing',
          relinkCount: 1,
          metadataOnly: true,
          nativePsdSmartObject: false,
          statusSummary: {
            state: 'missing',
            missing: true,
            repairRequired: true,
          },
          historySummary: {
            relinkCount: 1,
            lastRelinkAt: 1710000000000,
            lastSourceId: 'source-old',
          },
          warnings: [
            expect.objectContaining({ code: 'missing-source-asset' }),
            expect.objectContaining({ code: 'repair-required' }),
            expect.objectContaining({ code: 'metadata-only-psd-smart-object' }),
          ],
          preview: {
            layerBounds: { x: 0, y: 0, width: 2, height: 2 },
            sourceDimensions: { width: 640, height: 480 },
          },
          previewSignature: 'image-smart-source-linked-layer:v1:{"layerId":"paint-1","sourceId":"source-art","status":"missing","sourceExists":false,"relinkHistory":[{"at":1710000000000,"sourceId":"source-old"}],"snapshotId":null,"filterSignature":"image-smart-filter-stack:v1:[{\\"id\\":\\"filter-blur\\",\\"kind\\":\\"blur\\",\\"enabled\\":true,\\"amount\\":5,\\"opacity\\":0.8,\\"blendMode\\":\\"normal\\",\\"mask\\":\\"layer-filter-mask:v1:2x1:2:d277c7a0\\"}]","warnings":["missing-source-asset","repair-required","metadata-only-psd-smart-object"],"batchSuitable":false}',
          sourceSnapshotPreservation: {
            preserved: false,
            layerCount: 0,
            sourceIds: [],
            missingSourceIds: ['source-art'],
          },
          smartFilters: {
            filterCount: 1,
            enabledFilterCount: 1,
            nativePsdSmartFilters: false,
            limitationWarnings: [
              expect.objectContaining({
                code: 'metadata-only-smart-filters',
                message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
              }),
              {
                code: 'smart-filter-mask-unsupported',
                message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
              },
            ],
            metadataOnlyCaveats: [
              {
                descriptorId: 'psd-smart-filter-caveat:v1|layer=paint-1|code=metadata-only-smart-filters',
                code: 'metadata-only-smart-filters',
                message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
              },
              {
                descriptorId: 'psd-smart-filter-caveat:v1|layer=paint-1|code=smart-filter-mask-unsupported',
                code: 'smart-filter-mask-unsupported',
                message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
              },
            ],
            previewSignature: 'image-smart-filter-stack:v1:[{"id":"filter-blur","kind":"blur","enabled":true,"amount":5,"opacity":0.8,"blendMode":"normal","mask":"layer-filter-mask:v1:2x1:2:d277c7a0"}]',
          },
          roundtripSummary: {
            canRoundtripMetadata: true,
            nativePsdSmartObject: false,
            metadataOnlyPsdSmartObject: true,
            sourceId: 'source-art',
            status: 'missing',
            relinkCount: 1,
            warningCodes: ['missing-source-asset', 'repair-required', 'metadata-only-psd-smart-object'],
          },
          roundtripStrategy: {
            descriptorId: 'psd-smart-object-roundtrip:v1|layer=paint-1|source=source-art|status=missing|filters=1',
            strategy: 'package-source-and-retain-signal-loom-metadata',
            fallbackRoute: 'source-library-package',
            nativePsdSmartObject: false,
            metadataOnlyPsdSmartObject: true,
            caveats: [
              'Native PSD Smart Object records are not written.',
              'Smart Filter stacks are retained as Sloom Studio metadata only.',
              'Package the original linked source asset beside the PSD for safer round-trip recovery.',
            ],
          },
        },
      },
      {
        id: 'caption-1',
        name: 'Caption Type',
        type: 'text',
        exportMode: 'native-text',
        flattened: false,
        metadataOnly: false,
        psdChildIndex: 0,
        groupId: undefined,
        group: undefined,
        text: {
          contentLength: 7,
          fontFamily: 'Inter',
          fontSize: 18,
          metadataOnly: false,
          nativePsdTextLayer: true,
        },
        effects: undefined,
        mask: undefined,
        sourceLink: undefined,
      },
      {
        id: 'adjust-1',
        name: 'Print Curve',
        type: 'adjustment',
        exportMode: 'metadata-only',
        flattened: false,
        metadataOnly: true,
        psdChildIndex: null,
        groupId: undefined,
        group: undefined,
        text: undefined,
        effects: undefined,
        mask: undefined,
        sourceLink: undefined,
      },
    ]);
    expect(metadata.exportManifest?.layers[1].sourceLink?.roundtripStrategy?.caveats).toEqual([
      'Native PSD Smart Object records are not written.',
      'Smart Filter stacks are retained as Sloom Studio metadata only.',
      'Package the original linked source asset beside the PSD for safer round-trip recovery.',
    ]);
    expect(metadata.exportManifest?.layers[1].sourceLink?.smartFilters?.metadataOnlyCaveats).toEqual([
      {
        descriptorId: 'psd-smart-filter-caveat:v1|layer=paint-1|code=metadata-only-smart-filters',
        code: 'metadata-only-smart-filters',
        message: 'Image filter stacks stay editable in Sloom Studio metadata but are flattened for native PSD Smart Filter roundtrip.',
      },
      {
        descriptorId: 'psd-smart-filter-caveat:v1|layer=paint-1|code=smart-filter-mask-unsupported',
        code: 'smart-filter-mask-unsupported',
        message: 'Sloom Studio per-filter alpha masks are retained locally but are not preserved as native PSD Smart Filter masks.',
      },
    ]);
    expect(secondMetadata.exportManifest).toEqual(metadata.exportManifest);
  });

  it('serializes PSD export manifests with stable object key ordering', async () => {
    const interop = await import('./ImagePsdInterop') as typeof import('./ImagePsdInterop') & {
      serializeSignalLoomPsdExportManifest?: (manifest: unknown) => string;
    };
    const serialize = interop.serializeSignalLoomPsdExportManifest;
    const manifest = {
      version: 1,
      kind: 'signal-loom-psd-export-manifest',
      compatibility: {
        layerOrder: 'bottom-to-top',
        psdLayerOrder: 'top-to-bottom',
        nativeRasterLayers: true,
        nativeLayerGroups: false,
        nativeEditableText: false,
        nativeAdjustmentLayers: false,
        nativeLayerEffects: false,
        nativeLayerMasks: false,
        nativeSmartObjects: false,
      },
      summary: {
        layerCount: 1,
        exportedPixelLayerCount: 1,
        groupCount: 0,
        textLayerCount: 0,
        adjustmentLayerCount: 0,
        effectLayerCount: 0,
        maskLayerCount: 0,
        sourceLinkedLayerCount: 0,
        metadataOnlyLayerCount: 0,
        flattenedLayerCount: 0,
        warningCount: 0,
      },
      warnings: [],
      layers: [
        {
          id: 'layer-1',
          name: 'Paint',
          type: 'image',
          order: 0,
          psdChildIndex: 0,
          exportMode: 'native-raster',
          flattened: false,
          metadataOnly: false,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          bitmap: { width: 2, height: 2, left: 0, top: 0 },
          warningCodes: [],
        },
      ],
    };
    const sameManifestWithDifferentInsertionOrder = {
      layers: [
        {
          warningCodes: [],
          bitmap: { top: 0, left: 0, height: 2, width: 2 },
          blendMode: 'normal',
          opacity: 1,
          visible: true,
          metadataOnly: false,
          flattened: false,
          exportMode: 'native-raster',
          psdChildIndex: 0,
          order: 0,
          type: 'image',
          name: 'Paint',
          id: 'layer-1',
        },
      ],
      warnings: [],
      summary: {
        warningCount: 0,
        flattenedLayerCount: 0,
        metadataOnlyLayerCount: 0,
        sourceLinkedLayerCount: 0,
        maskLayerCount: 0,
        effectLayerCount: 0,
        adjustmentLayerCount: 0,
        textLayerCount: 0,
        groupCount: 0,
        exportedPixelLayerCount: 1,
        layerCount: 1,
      },
      compatibility: {
        nativeSmartObjects: false,
        nativeRasterLayers: true,
        nativeLayerMasks: false,
        nativeLayerGroups: false,
        nativeLayerEffects: false,
        nativeEditableText: false,
        nativeAdjustmentLayers: false,
        psdLayerOrder: 'top-to-bottom',
        layerOrder: 'bottom-to-top',
      },
      kind: 'signal-loom-psd-export-manifest',
      version: 1,
    };

    expect(serialize).toBeTypeOf('function');
    expect(serialize?.(sameManifestWithDifferentInsertionOrder)).toBe(serialize?.(manifest));
    expect(serialize?.(manifest)).toMatch(/^\{"compatibility":\{"layerOrder":"bottom-to-top","nativeAdjustmentLayers":false/);
    expect(JSON.parse(serialize?.(manifest) ?? '')).toEqual(manifest);
  });

  it('summarizes PSD native-construct readiness without claiming unsupported native parity', () => {
    const group = makeLayer({
      id: 'group-1',
      name: 'Panel Group',
      type: 'group',
      bitmap: null,
      groupExpanded: true,
    });
    const linkedSmartFilteredLayer = makeLayer({
      id: 'linked-paint',
      name: 'Linked Paint',
      groupId: 'group-1',
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.65, angle: 135, distance: 8, size: 12 },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 3, opacity: 0.75, blendMode: 'normal' },
        { id: 'filter-noise', kind: 'noise', enabled: false, amount: 8, opacity: 1, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'src-linked',
        sourceLabel: 'Linked plate',
        sourceLink: {
          id: 'src-linked',
          label: 'Linked plate',
          width: 1024,
          height: 768,
          status: 'linked',
          relinkHistory: [{ sourceId: 'src-original', label: 'Original', at: 1710000000000 }],
        },
      },
    });
    const text = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Ready',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 100,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
    });
    const adjustment = makeLayer({
      id: 'adjust',
      name: 'Levels',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'brightnessContrast', brightness: 4, contrast: 12 },
    });
    const doc = makeDoc({ layers: [group, linkedSmartFilteredLayer, text, adjustment] });

    const readiness = buildSignalLoomPsdNativeConstructReadiness(doc);
    const secondReadiness = buildSignalLoomPsdNativeConstructReadiness(doc);

    expect(readiness.constructs).toMatchObject({
      groups: {
        present: 1,
        importPreservation: 'native-structure',
        exportPreservation: 'native-structure',
        nativePsdSupported: true,
        flattened: false,
        metadataOnly: false,
      },
      retainedText: {
        present: 1,
        importPreservation: 'native-structure',
        exportPreservation: 'native-structure',
        nativePsdSupported: true,
        flattened: false,
        metadataOnly: false,
      },
      layerEffects: {
        present: 1,
        importPreservation: 'metadata-only',
        exportPreservation: 'flattened-raster-with-metadata',
        nativePsdSupported: false,
        flattened: true,
        metadataOnly: true,
      },
      adjustmentLayers: {
        present: 1,
        importPreservation: 'metadata-only',
        exportPreservation: 'metadata-only',
        nativePsdSupported: false,
        flattened: false,
        metadataOnly: true,
      },
      sourceLinkedSmartObjects: {
        present: 1,
        importPreservation: 'metadata-only',
        exportPreservation: 'flattened-raster-with-metadata',
        nativePsdSupported: false,
        flattened: true,
        metadataOnly: true,
      },
      smartFilters: {
        present: 2,
        importPreservation: 'metadata-only',
        exportPreservation: 'metadata-only',
        nativePsdSupported: false,
        flattened: false,
        metadataOnly: true,
        caveatCodes: ['metadata-only-smart-filters'],
      },
    });
    expect(readiness.warningCodes).toEqual([
      'native-smart-object',
      'adjustment-layer',
      'layer-effects',
      'metadata-only-smart-filters',
    ]);
    expect(readiness.roundTripRisk).toBe('high');
    expect(readiness.policy.nativeEditableText).toBe(true);
    expect(readiness.policy.nativeSmartObjects).toBe(false);
    expect(readiness.policy.nativeSmartFilters).toBe(false);
    expect(readiness.flattenedLayerIds).toEqual(['linked-paint']);
    expect(readiness.metadataOnlyLayerIds).toEqual(['adjust']);
    expect(readiness.manifestSignature).toMatch(/^signal-loom-psd-manifest:v1:/);
    expect(readiness.policySignature).toMatch(/^signal-loom-psd-policy:v1:/);
    expect(secondReadiness).toEqual(readiness);
  });

  it('describes PSD roundtrip risk with per-layer warnings and fallback routes', () => {
    const group = makeLayer({
      id: 'group-1',
      name: 'Panel Group',
      type: 'group',
      bitmap: null,
      groupExpanded: false,
    });
    const linkedPaint = makeLayer({
      id: 'linked-paint',
      name: 'Linked Paint',
      groupId: 'group-1',
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.65, angle: 135, distance: 8, size: 12 },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 3, opacity: 0.75, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'src-linked',
        sourceLabel: 'Linked plate',
        sourceLink: {
          id: 'src-linked',
          label: 'Linked plate',
          width: 1024,
          height: 768,
          status: 'linked',
          relinkHistory: [{ sourceId: 'src-original', label: 'Original', at: 1710000000000 }],
        },
      },
    });
    const caption = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Ready',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 100,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
    });
    const adjustment = makeLayer({
      id: 'adjust',
      name: 'Levels',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'brightnessContrast', brightness: 4, contrast: 12 },
    });
    const doc = makeDoc({ layers: [group, linkedPaint, caption, adjustment] });

    const readiness = buildSignalLoomPsdNativeConstructReadiness(doc) as ReturnType<typeof buildSignalLoomPsdNativeConstructReadiness> & {
      compatibilitySignature?: string;
      retainedMetadata?: {
        textLayerIds: string[];
        effectLayerIds: string[];
        sourceLinkedLayerIds: string[];
        filterLayerIds: string[];
      };
      recommendedFallbackRoutes?: Array<{ route: string }>;
      layerWarnings?: Array<{
        layerId: string;
        layerName: string;
        exportMode: string;
        flattened: boolean;
        metadataOnly: boolean;
        warnings: Array<{ code: string; fallbackRoute: string; message: string }>;
      }>;
    };

    expect(readiness.compatibilitySignature).toBe(
      'psd-readiness:v1|layers=4|risk=high|retained=text:1,effects:1,sourceLinks:1,filters:1|flattened=linked-paint|metadataOnly=adjust|warnings=native-smart-object,adjustment-layer,layer-effects,metadata-only-smart-filters',
    );
    expect(readiness.retainedMetadata).toEqual({
      textLayerIds: ['caption'],
      effectLayerIds: ['linked-paint'],
      sourceLinkedLayerIds: ['linked-paint'],
      filterLayerIds: ['linked-paint'],
    });
    expect(readiness.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'psd-signal-loom-metadata',
      'source-library-package',
      'tiff-visible-composite',
      'png-visible-composite',
    ]);
    expect(readiness.layerWarnings?.map((layer) => ({
      layerId: layer.layerId,
      exportMode: layer.exportMode,
      flattened: layer.flattened,
      metadataOnly: layer.metadataOnly,
      warningCodes: layer.warnings.map((warning) => warning.code),
    }))).toEqual([
      {
        layerId: 'linked-paint',
        exportMode: 'flattened-raster',
        flattened: true,
        metadataOnly: false,
        warningCodes: ['native-smart-object', 'layer-effects', 'metadata-only-smart-filters'],
      },
      {
        layerId: 'adjust',
        exportMode: 'metadata-only',
        flattened: false,
        metadataOnly: true,
        warningCodes: ['adjustment-layer'],
      },
    ]);
    expect(readiness.layerWarnings?.find((layer) => layer.layerId === 'linked-paint')?.warnings[0]).toMatchObject({
      code: 'native-smart-object',
      fallbackRoute: 'source-library-package',
      descriptorId: 'psd-layer-warning:v1|layer=linked-paint|code=native-smart-object|mode=flattened-raster',
      nativeConstruct: 'smart-object',
    });
    expect(readiness.layerWarnings?.find((layer) => layer.layerId === 'linked-paint')?.warnings[0]?.message).toMatch(/source-linked/i);
    expect(readiness.layerWarnings?.find((layer) => layer.layerId === 'linked-paint')?.warnings[2]).toMatchObject({
      code: 'metadata-only-smart-filters',
      descriptorId: 'psd-layer-warning:v1|layer=linked-paint|code=metadata-only-smart-filters|mode=flattened-raster',
      nativeConstruct: 'smart-filter',
    });
    expect(buildSignalLoomPsdNativeConstructReadiness(doc)).toMatchObject({
      compatibilitySignature: readiness.compatibilitySignature,
      layerWarnings: readiness.layerWarnings,
    });
  });

  it('builds deterministic PSD import/export roundtrip risk signatures', () => {
    const linkedPaint = makeLayer({
      id: 'linked-paint',
      name: 'Linked Paint',
      effects: [
        { id: 'fx-stroke', kind: 'stroke', enabled: true, color: '#ffffff', opacity: 1, size: 2, position: 'outside' },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 3, opacity: 0.75, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'src-linked',
        sourceLabel: 'Linked plate',
        sourceLink: {
          id: 'src-linked',
          label: 'Linked plate',
          width: 1024,
          height: 768,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const caption = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Roundtrip',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
    });

    const descriptor = buildSignalLoomPsdRoundtripRiskDescriptor(makeDoc({
      layers: [linkedPaint, caption],
    }));
    const secondDescriptor = buildSignalLoomPsdRoundtripRiskDescriptor(makeDoc({
      layers: [linkedPaint, caption],
    }));

    expect(descriptor).toMatchObject({
      descriptorId: 'psd-roundtrip-risk:v1|risk=high|layers=2',
      risk: 'high',
      sourcePackageRequired: true,
      fallbackRouteOrder: [
        'psd-signal-loom-metadata',
        'source-library-package',
        'tiff-visible-composite',
        'png-visible-composite',
      ],
      signatures: {
        import: 'psd-import-roundtrip:v1|nativeRaster=true|metadataOnly=none|warnings=native-smart-object,layer-effects,metadata-only-smart-filters',
        export: 'psd-export-roundtrip:v1|flattened=linked-paint|metadataOnly=none|retained=text:caption,effects:linked-paint,sourceLinks:linked-paint,filters:linked-paint',
        nativeConstructs: 'psd-native-constructs:v1|nativeEditableText=true|nativeEffects=false|nativeSmartObjects=false|nativeSmartFilters=false|caveats=native-smart-object,layer-effects,metadata-only-smart-filters',
      },
    });
    expect(descriptor.riskFactors.map((factor) => ({
      code: factor.code,
      nativeConstruct: factor.nativeConstruct,
      affectedLayerIds: factor.affectedLayerIds,
      fallbackRoute: factor.fallbackRoute,
      preservation: factor.preservation,
    }))).toEqual([
      {
        code: 'native-smart-object',
        nativeConstruct: 'smart-object',
        affectedLayerIds: ['linked-paint'],
        fallbackRoute: 'source-library-package',
        preservation: 'flattened-raster-with-metadata',
      },
      {
        code: 'layer-effects',
        nativeConstruct: 'layer-effects',
        affectedLayerIds: ['linked-paint'],
        fallbackRoute: 'psd-signal-loom-metadata',
        preservation: 'flattened-raster-with-metadata',
      },
      {
        code: 'metadata-only-smart-filters',
        nativeConstruct: 'smart-filter',
        affectedLayerIds: ['linked-paint'],
        fallbackRoute: 'source-library-package',
        preservation: 'metadata-only',
      },
    ]);
    expect(secondDescriptor).toEqual(descriptor);
  });

  it('aggregates PSD native construct warnings into stable document records', () => {
    const group = makeLayer({
      id: 'group-1',
      name: 'Panel Group',
      type: 'group',
      bitmap: null,
      groupExpanded: false,
    });
    const linkedPaint = makeLayer({
      id: 'linked-paint',
      name: 'Linked Masked Paint',
      groupId: 'group-1',
      mask: makeBitmap(2, 2, [255, 255, 255, 255]),
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.65, angle: 135, distance: 8, size: 12 },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 3, opacity: 0.75, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'src-linked',
        sourceLabel: 'Linked plate',
        sourceLink: {
          id: 'src-linked',
          label: 'Linked plate',
          width: 1024,
          height: 768,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const caption = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Ready',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 100,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
    });
    const adjustment = makeLayer({
      id: 'adjust',
      name: 'Levels',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'brightnessContrast', brightness: 4, contrast: 12 },
    });

    const readiness = buildSignalLoomPsdNativeConstructReadiness(makeDoc({
      layers: [group, linkedPaint, caption, adjustment],
    })) as ReturnType<typeof buildSignalLoomPsdNativeConstructReadiness> & {
      nativeConstructWarnings?: Array<{
        descriptorId: string;
        code: string;
        nativeConstruct: string;
        present: number;
        affectedLayerIds: string[];
        importPreservation: string;
        exportPreservation: string;
        nativePsdSupported: boolean;
        flattened: boolean;
        metadataOnly: boolean;
        fallbackRoute: string;
        message: string;
      }>;
    };

    expect(readiness.constructs).toMatchObject({
      layerMasks: {
        present: 1,
        importPreservation: 'native-structure',
        exportPreservation: 'native-structure',
        nativePsdSupported: true,
        flattened: false,
        metadataOnly: false,
      },
    });
    expect(readiness.nativeConstructWarnings?.map((warning) => ({
      descriptorId: warning.descriptorId,
      code: warning.code,
      nativeConstruct: warning.nativeConstruct,
      present: warning.present,
      affectedLayerIds: warning.affectedLayerIds,
      importPreservation: warning.importPreservation,
      exportPreservation: warning.exportPreservation,
      nativePsdSupported: warning.nativePsdSupported,
      flattened: warning.flattened,
      metadataOnly: warning.metadataOnly,
      fallbackRoute: warning.fallbackRoute,
    }))).toEqual([
      {
        descriptorId: 'psd-native-construct-warning:v1|code=native-smart-object|present=1|layers=linked-paint',
        code: 'native-smart-object',
        nativeConstruct: 'smart-object',
        present: 1,
        affectedLayerIds: ['linked-paint'],
        importPreservation: 'metadata-only',
        exportPreservation: 'flattened-raster-with-metadata',
        nativePsdSupported: false,
        flattened: true,
        metadataOnly: true,
        fallbackRoute: 'source-library-package',
      },
      {
        descriptorId: 'psd-native-construct-warning:v1|code=adjustment-layer|present=1|layers=adjust',
        code: 'adjustment-layer',
        nativeConstruct: 'adjustment-layer',
        present: 1,
        affectedLayerIds: ['adjust'],
        importPreservation: 'metadata-only',
        exportPreservation: 'metadata-only',
        nativePsdSupported: false,
        flattened: false,
        metadataOnly: true,
        fallbackRoute: 'psd-signal-loom-metadata',
      },
      {
        descriptorId: 'psd-native-construct-warning:v1|code=layer-effects|present=1|layers=linked-paint',
        code: 'layer-effects',
        nativeConstruct: 'layer-effects',
        present: 1,
        affectedLayerIds: ['linked-paint'],
        importPreservation: 'metadata-only',
        exportPreservation: 'flattened-raster-with-metadata',
        nativePsdSupported: false,
        flattened: true,
        metadataOnly: true,
        fallbackRoute: 'psd-signal-loom-metadata',
      },
      {
        descriptorId: 'psd-native-construct-warning:v1|code=metadata-only-smart-filters|present=1|layers=linked-paint',
        code: 'metadata-only-smart-filters',
        nativeConstruct: 'smart-filter',
        present: 1,
        affectedLayerIds: ['linked-paint'],
        importPreservation: 'metadata-only',
        exportPreservation: 'metadata-only',
        nativePsdSupported: false,
        flattened: false,
        metadataOnly: true,
        fallbackRoute: 'source-library-package',
      },
    ]);
    expect(readiness.nativeConstructWarnings?.some((warning) => warning.code === 'layer-mask')).toBe(false);
  });

  it('detects PSB and reports a large-document unsupported message', () => {
    const psb = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 2, 0, 0]).buffer;
    const oversizedPsd = makePhotoshopHeaderBuffer({ version: 1, width: 30001, height: 2000 });

    expect(detectPhotoshopDocumentKind(psb)).toBe('psb');
    expect(() => psdArrayBufferToImageDocument(psb, { id: 'psb', title: 'Large' })).toThrow(/PSB large-document/);
    expect(detectPhotoshopDocumentKind(oversizedPsd)).toBe('psd');
    expect(() => psdArrayBufferToImageDocument(oversizedPsd, { id: 'oversized', title: 'Too Wide' })).toThrow(/30,000 px/);
  });

  it('imports PSD layers back into bottom-to-top Image workspace order', () => {
    const psd: Psd = {
      width: 16,
      height: 9,
      children: [
        {
          name: 'Top Line Art',
          left: 3,
          top: 1,
          right: 5,
          bottom: 3,
          opacity: 0.75,
          hidden: true,
          blendMode: 'screen',
          imageData: makePsdImageData(2, 2, [0, 0, 0, 255]),
        },
        {
          name: 'Bottom Color',
          left: 0,
          top: 2,
          right: 4,
          bottom: 4,
          opacity: 1,
          hidden: false,
          blendMode: 'multiply',
          imageData: makePsdImageData(4, 2, [255, 32, 16, 255]),
        },
      ],
    };

    const doc = psdDocumentToImageDocument(psd, {
      id: 'imported-psd',
      title: 'Imported Board',
    });

    expect(doc).toMatchObject({
      id: 'imported-psd',
      title: 'Imported Board',
      width: 16,
      height: 9,
      activeLayerId: 'imported-psd-layer-1',
    });
    expect(doc.layers.map((layer) => layer.name)).toEqual(['Bottom Color', 'Top Line Art']);
    expect(doc.layers[0]).toMatchObject({
      id: 'imported-psd-layer-0',
      x: 0,
      y: 2,
      visible: true,
      opacity: 1,
      blendMode: 'multiply',
    });
    expect(doc.layers[1]).toMatchObject({
      id: 'imported-psd-layer-1',
      x: 3,
      y: 1,
      visible: false,
      opacity: 0.75,
      blendMode: 'screen',
    });
    expect(doc.layers[1].bitmap?.width).toBe(2);
    expect(doc.layers[1].bitmap?.height).toBe(2);
  });

  it('declines retained metadata for duplicate PSD names after an external deletion shifts order', () => {
    const psd: Psd = {
      width: 1,
      height: 1,
      children: [{
        name: 'Duplicate',
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
        imageData: makePsdImageData(1, 1, [0, 0, 255, 255]),
      }],
    };
    Object.assign(psd, {
      [SIGNAL_LOOM_PSD_METADATA_KEY]: {
        version: 1,
        layers: [
          { id: 'deleted-original-bottom', order: 0, name: 'Duplicate', type: 'image' },
          {
            id: 'surviving-original-top',
            order: 1,
            name: 'Duplicate',
            type: 'text',
            text: { content: 'must not attach' },
          },
        ],
      },
    });

    const imported = psdDocumentToImageDocument(psd, {
      id: 'externally-edited-duplicates',
      title: 'Externally edited duplicates',
    });

    expect(imported.layers).toHaveLength(1);
    expect(imported.layers[0]).toMatchObject({
      id: 'externally-edited-duplicates-layer-0',
      name: 'Duplicate',
      type: 'image',
    });
    expect(imported.layers[0]?.text).toBeUndefined();
  });

  it('reports native PSD user-mask pixels, density, and feather as native rather than metadata-only', async () => {
    const doc = makeDoc({
      layers: [makeLayer({
        id: 'native-mask',
        name: 'Native mask',
        mask: makeBitmap(2, 2, [255, 255, 255, 128]),
        maskDensity: 0.5,
        maskFeather: 1.25,
      })],
    });

    const psd = buildPsdDocumentFromImageDocument(doc);
    expect(psd.children?.[0]?.mask).toMatchObject({
      imageData: { width: 2, height: 2 },
      userMaskDensity: 0.5,
      userMaskFeather: 1.25,
    });
    const imported = psdDocumentToImageDocument(psd, { id: 'native-mask-import', title: 'Native mask import' });
    expect(imported.layers[0]).toMatchObject({
      maskDensity: 0.5,
      maskFeather: 1.25,
    });
    expect(imported.layers[0]?.mask?.width).toBe(2);

    const readiness = buildSignalLoomPsdNativeConstructReadiness(doc);
    expect(readiness.policy.nativeLayerMasks).toBe(true);
    expect(readiness.constructs.layerMasks).toEqual({
      present: 1,
      importPreservation: 'native-structure',
      exportPreservation: 'native-structure',
      nativePsdSupported: true,
      flattened: false,
      metadataOnly: false,
      caveatCodes: [],
    });
    expect(readiness.warningCodes).not.toContain('layer-mask');
    expect(readiness.flattenedLayerIds).toEqual([]);
    expect(readiness.compatibilitySignature).toContain('flattened=none');
    expect(readiness.compatibilitySignature).toContain('warnings=none');
    expect(readiness.layerWarnings).toEqual([]);

    const embeddedManifest = readSignalLoomPsdMetadata(psd).exportManifest;
    expect(embeddedManifest?.summary).toMatchObject({
      maskLayerCount: 1,
      flattenedLayerCount: 0,
      warningCount: 0,
    });
    expect(embeddedManifest?.layers).toEqual([
      expect.objectContaining({
        id: 'native-mask',
        exportMode: 'native-raster',
        flattened: false,
        metadataOnly: false,
        warningCodes: [],
      }),
    ]);
    expect(readSignalLoomPsdMetadata(psd).unsupportedNativeConstructs.map((warning) => warning.code)).not.toContain('layer-mask');

    const bytes = await (await imageDocumentToPsdBlob(doc)).arrayBuffer();
    expect(new Uint8Array(bytes, 0, 4)).toEqual(new Uint8Array([0x38, 0x42, 0x50, 0x53]));
    const byteImported = psdArrayBufferToImageDocument(bytes, { id: 'native-mask-bytes', title: 'Native mask bytes' });
    expect(byteImported.layers[0]?.maskDensity).toBeCloseTo(0.5, 2);
    expect(byteImported.layers[0]).toMatchObject({
      maskFeather: 1.25,
      mask: { width: 2, height: 2 },
    });
  });

  it('round-trips native user masks attached to PSD groups through real PSD bytes', async () => {
    const doc = makeDoc({
      layers: [{
        ...makeLayer({
          id: 'masked-group',
          name: 'Masked group',
          type: 'group',
          bitmap: null,
          mask: makeBitmap(4, 4, [255, 255, 255, 96]),
          maskDensity: 0.9,
          maskFeather: 2.5,
        }),
        groupId: undefined,
      }, makeLayer({
        id: 'group-child',
        name: 'Group child',
        groupId: 'masked-group',
        bitmap: makeBitmap(2, 2, [255, 0, 0, 255]),
      })],
    });

    const psd = buildPsdDocumentFromImageDocument(doc);
    const group = psd.children?.[0];
    expect(group?.children).toHaveLength(1);
    expect(group?.mask).toMatchObject({
      imageData: { width: 4, height: 4 },
      userMaskDensity: 0.9,
      userMaskFeather: 2.5,
    });

    const imported = psdDocumentToImageDocument(psd, { id: 'masked-group-import', title: 'Masked group import' });
    expect(imported.layers[0]).toMatchObject({
      type: 'group',
      maskDensity: 0.9,
      maskFeather: 2.5,
    });
    expect(imported.layers[0]?.mask?.width).toBe(4);
    expect(imported.layers[0]?.mask?.height).toBe(4);

    const bytes = await (await imageDocumentToPsdBlob(doc)).arrayBuffer();
    expect(new Uint8Array(bytes, 0, 4)).toEqual(new Uint8Array([0x38, 0x42, 0x50, 0x53]));
    const byteImported = psdArrayBufferToImageDocument(bytes, { id: 'masked-group-bytes', title: 'Masked group bytes' });
    expect(byteImported.layers[0]).toMatchObject({
      type: 'group',
      maskFeather: 2.5,
    });
    expect(byteImported.layers[0]?.maskDensity).toBeCloseTo(0.9, 2);
    expect(byteImported.layers[0]?.mask?.width).toBe(4);
    expect(byteImported.layers[0]?.mask?.height).toBe(4);
  });

  it('serializes the active document as a Photoshop PSD blob', async () => {
    const blob = await imageDocumentToPsdBlob(makeDoc({
      layers: [makeLayer({ name: 'Paint Layer' })],
    }));

    expect(blob.type).toBe(IMAGE_PSD_MIME_TYPE);
    expect(blob.size).toBeGreaterThan(100);
  });
});

function makePsdImageData(width: number, height: number, fill: [number, number, number, number]): PsdLayer['imageData'] {
  return makeImageData(width, height, fill);
}

function makePhotoshopHeaderBuffer(options: { version: 1 | 2; width: number; height: number }): ArrayBuffer {
  const bytes = new Uint8Array(26);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, options.version, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, options.height, false);
  view.setUint32(18, options.width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes.buffer;
}
