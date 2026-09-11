import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSelectedImageLayerPropertyDescriptor,
  ImageEditorPropertiesPanel,
} from './ImageEditorPropertiesPanel';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { DEFAULT_PROVIDER_SETTINGS } from '../../lib/providerCatalog';
import { useSettingsStore } from '../../store/settingsStore';
import { createMask } from './SelectionMask';
import { setSelection } from './selectionRegistry';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_GRADIENT_TOOL_SETTINGS,
  DEFAULT_SHAPE_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  DEFAULT_TEXT_TOOL_SETTINGS,
  type ImageLayer,
} from '../../types/imageEditor';
import { beginSelectionTransformSession, clearSelectionTransformSession } from './ImageSelectionTransform';

class FakeHistogramContext {
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  clearRect() {}

  getImageData(): ImageData {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let index = 0; index < this.width * this.height; index += 1) {
      const offset = index * 4;
      const value = index % 2 === 0 ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
    return { width: this.width, height: this.height, data } as ImageData;
  }
}

class FakeHistogramCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: FakeHistogramContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeHistogramContext(width, height);
  }

  getContext() {
    return this.context;
  }
}

describe('ImageEditorPropertiesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeHistogramCanvas);
    clearSelectionTransformSession();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      tool: 'move',
      brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      gradientToolSettings: { ...DEFAULT_GRADIENT_TOOL_SETTINGS },
      shapeToolSettings: { ...DEFAULT_SHAPE_TOOL_SETTINGS },
      selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
      textToolSettings: { ...DEFAULT_TEXT_TOOL_SETTINGS },
      viewportContainerSize: { width: 0, height: 0 },
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });
    useSettingsStore.setState({
      providerSettings: { ...DEFAULT_PROVIDER_SETTINGS },
    });
  });

  it('keeps document-only controls out of the panel until a document is open', () => {
    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel />);
    // Tool Options always lead the panel.
    expect(html).toContain('Tool Options');
    expect(html).toContain('No document open');
    expect(html).not.toContain('Document Properties');
    expect(html).not.toContain('Liquify Workspace');
    expect(html).not.toContain('aria-label="Histogram channel"');
    expect(html).not.toContain('Color Proof');
    expect(html).not.toContain('Source / Bit Depth');
  });

  it('exposes bounded magnetic radius and edge-contrast controls when magnetic lasso is selected', () => {
    useImageEditorStore.setState({
      tool: 'lasso',
      selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS, lassoShape: 'magnetic' },
    });
    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel />);
    expect(html).toContain('Magnetic sensitivity');
    expect(html).toContain('Snap radius');
    expect(html).toContain('Edge contrast');
  });

  it('fills dockable panel height instead of imposing a nested viewport-height scroll box', () => {
    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('h-full');
    expect(html).toContain('min-h-0');
    expect(html).toContain('overflow-y-auto');
    expect(html).not.toContain('max-h-[52vh]');
  });

  it('renders image resize, canvas resize, and upscale controls for an open document', () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'doc-1',
      title: 'image.png',
      width: 1024,
      height: 768,
    }));

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Image Size');
    expect(html).toContain('Canvas Size');
    expect(html).toContain('Upscale 2x');
  });

  it('renders pen-path styling controls and placement guidance when the Pen tool is active', () => {
    useImageEditorStore.getState().setTool('pen' as never);

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Pen');
    expect(html).toContain('Fill Opacity');
    expect(html).toContain('Stroke Width');
    expect(html).toContain('Click to add anchor points');
  });

  it('renders compact histogram channel controls and clipping readouts for an open document', () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'doc-1',
      title: 'image.png',
      width: 2,
      height: 1,
    }));

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('aria-label="Histogram channel"');
    expect(html).toContain('<option value="red">Red</option>');
    expect(html).toContain('<option value="alpha">Alpha (non-tonal)</option>');
    expect(html).toContain('Shadow Clip');
    expect(html).toContain('Highlight Clip');
  });

  it('renders document color proof controls with RGB-centric limitations', () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'doc-proof-panel',
      title: 'proof.png',
      width: 2,
      height: 1,
    }));

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Color Proof');
    expect(html).toContain('aria-label="Image color proof mode"');
    expect(html).toContain('CMYK proof setup (legacy metadata)');
    expect(html).toContain('aria-label="Image proof intent"');
    expect(html).toContain('Image currently composites and exports pixels through the RGB renderer.');
    expect(html).toContain('Native CMYK export: Not available');
  });

  it('renders source format and working bit-depth limitations for the active document', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-source-status',
      title: 'scan.tiff',
      width: 2,
      height: 1,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      metadata: {
        sourceFormat: 'TIFF',
        sourceMimeType: 'image/tiff',
        warnings: ['Animated GIF opened as the first frame only.'],
      },
    });

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Source / Bit Depth');
    expect(html).toContain('TIFF');
    expect(html).toContain('image/tiff');
    expect(html).toContain('8-bit RGBA browser raster');
    expect(html).toContain('8-bit/channel provenance');
    expect(html).toContain('8-bit/channel data is preserved in the 8-bit RGBA working pipeline.');
    expect(html).toContain('Animated GIF opened as the first frame only.');
  });

  it('distinguishes retained high-bit source provenance from the 8-bit editable derivative', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-high-bit-source',
      title: 'grade.png',
      width: 2,
      height: 1,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      metadata: { sourceFormat: 'PNG', sourceMimeType: 'image/png', sourceBitDepth: 16 },
    });

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('16-bit/channel provenance');
    expect(html).toContain('16-bit source precision is retained as provenance only');
    expect(html).toContain('8-bit RGBA working derivative');
  });

  it('renders native high-bit working authority and derived proxy truth', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-native-high-bit',
      title: 'grade.png',
      width: 2,
      height: 1,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      metadata: {
        sourceFormat: 'PNG',
        sourceMimeType: 'image/png',
        sourceBitDepth: 16,
        bitDepth: 16,
      },
    });

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('16-bit RGBA authority');
    expect(html).toContain('16-bit/channel native integer RGBA authority');
    expect(html).toContain('precision is retained in the native document authority');
    expect(html).toContain('derived 8-bit proxy');
    expect(html).toContain('Native export: PNG16 or TIFF16');
  });

  it('shows the selected universal upscale method based on Android accelerator configuration', () => {
    useSettingsStore.getState().setProviderSetting('androidAcceleratorBaseUrl', 'http://192.168.1.42:8788');
    useSettingsStore.getState().setProviderSetting('androidAcceleratorDefaultUpscaler', 'upscaler_anime');
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'doc-1',
      title: 'image.png',
      width: 1024,
      height: 768,
    }));

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Android accelerator: NPU/GPU upscaler');
    expect(html).toContain('upscaler_anime');
  });

  it('renders crop aspect and guide controls when the crop tool is active', () => {
    useImageEditorStore.getState().setTool('crop');

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Aspect');
    expect(html).toContain('Original');
    expect(html).toContain('16:9');
    expect(html).toContain('Guides');
    expect(html).toContain('Thirds');
    expect(html).toContain('Grid');
    expect(html).toContain('Delete Cropped Pixels');
    expect(html).toContain('Straighten / Rotate Crop');
    expect(html).toContain('aria-label="Crop rotation degrees"');
    expect(html).toContain('Reset Straighten');
  });

  it('renders sample-all-layers and contiguous controls for Magic Wand, Background Eraser, Magic Eraser, and Paint Bucket', () => {
    useImageEditorStore.getState().setTool('magicWand');
    const wandHtml = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    useImageEditorStore.getState().setTool('backgroundEraser' as never);
    const backgroundEraserHtml = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    useImageEditorStore.getState().setTool('magicEraser' as never);
    const magicEraserHtml = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    useImageEditorStore.getState().setTool('paintBucket');
    const bucketHtml = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(wandHtml).toContain('Sample All Layers');
    expect(wandHtml).toContain('Contiguous');
    expect(backgroundEraserHtml).toContain('Background Eraser');
    expect(backgroundEraserHtml).toContain('Tolerance');
    expect(backgroundEraserHtml).toContain('Contiguous');
    expect(backgroundEraserHtml).toContain('Sampling');
    expect(backgroundEraserHtml).toContain('Once');
    expect(backgroundEraserHtml).toContain('Continuous');
    expect(backgroundEraserHtml).toContain('Use Background Swatch');
    expect(backgroundEraserHtml).toContain('Limits');
    expect(backgroundEraserHtml).toContain('Discontiguous');
    expect(backgroundEraserHtml).toContain('Protect Foreground');
    expect(magicEraserHtml).toContain('Magic Eraser');
    expect(magicEraserHtml).toContain('Tolerance');
    expect(magicEraserHtml).toContain('Contiguous');
    expect(bucketHtml).toContain('Sample All Layers');
    expect(bucketHtml).toContain('Contiguous');
  });

  it('renders persisted gradient mode, preset, and reverse controls when the gradient tool is active', () => {
    useImageEditorStore.getState().setTool('gradientTool');

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Gradient Mode');
    expect(html).toContain('Foreground → Background');
    expect(html).toContain('Foreground → Transparent');
    expect(html).toContain('Reverse Gradient');
    expect(html).toContain('Radial');
    expect(html).toContain('Angle');
  });

  it('renders typography controls when the Text tool is active', () => {
    useImageEditorStore.getState().setTool('text');

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Baseline');
    expect(html).toContain('Kerning');
    expect(html).toContain('Caps');
    expect(html).toContain('Small Caps');
    expect(html).toContain('All Small Caps');
  });

  it('renders bounded gradient stop controls when the gradient tool is active', () => {
    useImageEditorStore.getState().setTool('gradientTool');

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Gradient Stops');
    expect(html).toContain('Gradient Preset');
    expect(html).toContain('Warm Sunset');
    expect(html).toContain('Cool Dawn');
    expect(html).toContain('Add Stop');
    expect(html).toContain('Remove Stop');
    expect(html).toContain('Dither');
    expect(html).toContain('Start Stop');
    expect(html).toContain('Middle Stop');
    expect(html).toContain('End Stop');
    expect(html).toContain('aria-label="Gradient middle stop color"');
    expect(html).toContain('aria-label="Gradient middle stop offset"');
    expect(html).toContain('aria-label="Gradient middle stop opacity"');
  });

  it('renders brush tool-options (without the preset library) when the brush tool is active', () => {
    useImageEditorStore.getState().setTool('brush');

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    // Tool options (and the active-brush header) live in the Properties panel.
    expect(html).toContain('Soft Round');
    expect(html).toContain('Symmetry');
    expect(html).toContain('Vertical');
    expect(html).toContain('Four-Way');
    // The brush library (preset grid + pack import/export) moved to the Brushes palette.
    expect(html).not.toContain('Save Preset');
    expect(html).not.toContain('Brush preset pack JSON');
    expect(html).not.toContain('data-brush-preset-preview=');
  });

  it('renders transform-selection controls in the Move panel when a selection session is active', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-transform',
      title: 'selection.png',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    beginSelectionTransformSession(doc.id);

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Transform Selection');
    expect(html).toContain('aria-label="Selection X"');
    expect(html).toContain('aria-label="Selection Y"');
    expect(html).toContain('aria-label="Selection width"');
    expect(html).toContain('aria-label="Selection height"');
    expect(html).toContain('aria-label="Selection rotation"');
    expect(html).toContain('Apply Selection');
    expect(html).toContain('Cancel Selection');
  });

  it('renders a non-canvas generative-edit visibility control when a selection is active', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-generative-reopen',
      title: 'selection.png',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    const html = renderToStaticMarkup(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);

    expect(html).toContain('Generative Edit');
    expect(html).toContain('Hide Generative Edit');
  });

  it('builds a deterministic selected layer property descriptor without rendering UI', () => {
    const selectedLayer: ImageLayer = {
      id: 'layer-title',
      name: 'Hero Title',
      type: 'text',
      visible: true,
      locked: false,
      locks: { pixels: true, position: false },
      opacity: 0.72,
      blendMode: 'screen',
      x: 12.4,
      y: 8.6,
      rotationDeg: 5.25,
      skewXDeg: -2,
      skewYDeg: 1.5,
      perspectiveX: 0.1,
      perspectiveY: -0.2,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
      bitmap: { width: 320, height: 90 } as OffscreenCanvas,
      bitmapVersion: 7,
      mask: { width: 320, height: 90 } as OffscreenCanvas,
      maskDensity: 64,
      maskFeather: 3.5,
      text: {
        ...DEFAULT_TEXT_TOOL_SETTINGS,
        content: 'Launch',
        fontFamily: 'Inter',
        fontSize: 42,
        boxWidth: 300,
        boxHeight: 80,
        wrap: true,
        align: 'center',
      },
      effects: [
        {
          id: 'fx-shadow',
          kind: 'dropShadow',
          enabled: true,
          color: '#000000',
          opacity: 0.5,
          angle: 120,
          distance: 12,
          size: 8,
        },
        {
          id: 'fx-glow',
          kind: 'outerGlow',
          enabled: false,
          color: '#66ccff',
          opacity: 0.4,
          size: 10,
        },
      ],
      metadata: {
        editableText: true,
        sourceLabel: 'logo.svg',
        sourceFormat: 'SVG',
        sourceMimeType: 'image/svg+xml',
        sourceLink: {
          id: 'source-7',
          label: 'Logo source',
          width: 640,
          height: 180,
          status: 'linked',
          relinkHistory: [{ sourceId: 'source-1', label: 'Original logo', at: 10 }],
        },
        sourceWarnings: ['SVG filters were rasterized on import.'],
        vectorShape: {
          kind: 'path',
          width: 320,
          height: 90,
          points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          closed: true,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#112233',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
        originalSvgSource: '<svg><path d="M0 0h10v10z"/></svg>',
      },
      vectorRecipe: '<svg><path d="M0 0h10v10z"/></svg>',
    };
    const doc = createEmptyImageDocument({
      id: 'doc-properties',
      title: 'poster.sloom',
      width: 1024,
      height: 768,
      sourceBinItemId: 'doc-source',
    });

    const descriptor = buildSelectedImageLayerPropertyDescriptor({
      ...doc,
      layers: [
        { ...selectedLayer, id: 'background', name: 'Background', type: 'image' },
        selectedLayer,
      ],
      activeLayerId: selectedLayer.id,
      activeLayerEditTarget: 'mask',
      metadata: {
        sourceFormat: 'PSD',
        sourceMimeType: 'image/vnd.adobe.photoshop',
        warnings: ['Layer comps are not editable.'],
      },
    });

    expect(descriptor?.geometry).toEqual({
      x: 12.4,
      y: 8.6,
      width: 320,
      height: 90,
      rotationDeg: 5.25,
      skewXDeg: -2,
      skewYDeg: 1.5,
      perspectiveX: 0.1,
      perspectiveY: -0.2,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
    });
    expect(descriptor?.typeSummary).toEqual({
      type: 'text',
      label: 'Text layer',
      visible: true,
      locked: false,
      lockSummary: 'pixels',
      opacityPercent: 72,
      blendMode: 'screen',
    });
    expect(descriptor?.source).toMatchObject({
      documentSourceBinItemId: 'doc-source',
      sourceLabel: 'logo.svg',
      sourceFormat: 'SVG',
      sourceMimeType: 'image/svg+xml',
      sourceLinkStatus: 'linked',
      sourceLinkLabel: 'Logo source',
      sourceLinkSize: '640x180',
      relinkCount: 1,
    });
    expect(descriptor?.mask).toEqual({
      hasMask: true,
      editTarget: 'mask',
      densityPercent: 64,
      featherPx: 3.5,
      size: '320x90',
    });
    expect(descriptor?.vector).toEqual({
      hasVectorData: true,
      shapeKind: 'path',
      hasSvgSource: true,
      recipeSignature: 'svg:34:43298',
    });
    expect(descriptor?.text).toEqual({
      editable: true,
      contentPreview: 'Launch',
      fontFamily: 'Inter',
      fontSizePx: 42,
      align: 'center',
      wrap: true,
      box: '300x80',
    });
    expect(descriptor?.effects).toEqual({
      total: 2,
      enabled: 1,
      kinds: ['dropShadow', 'outerGlow'],
    });
    expect(descriptor?.unsupportedPropertyEditingCaveats).toEqual([
      'SVG source properties are metadata-only after import.',
      'SVG filters were rasterized on import.',
      'Layer comps are not editable.',
      'Native effect parameter editing is limited to Sloom Studio effect controls.',
      'Vector path editing is available only for retained Sloom Studio vector geometry.',
    ]);
    expect(descriptor?.preview).toEqual({
      label: 'Hero Title · Text layer',
      boundsLabel: '320x90 at 12.4,8.6',
      sourceLabel: 'logo.svg',
      signature: descriptor?.signature,
    });
    expect(descriptor?.signature).toBe(
      'doc-properties|layer-title|text|12.4,8.6,320,90|rot:5.25|skew:-2,1.5|persp:0.1,-0.2|origin:0.25,0.75|vis:1|lock:0|locks:pixels|op:72|blend:screen|mask:1:64:3.5|src:SVG:image/svg+xml:linked|vec:path:svg:34:43298|text:Inter:42:center:wrap:6|fx:dropShadow,outerGlow:1/2|v:7',
    );
  });

  it('returns a stable empty selected-layer descriptor when no layer is selected', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-empty',
      title: 'empty.png',
      width: 640,
      height: 480,
    });

    expect(buildSelectedImageLayerPropertyDescriptor(doc)).toBeNull();
  });

});
