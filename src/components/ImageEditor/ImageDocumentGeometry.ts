import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { imageDocumentHasPhysicalTiltmarkSurface } from './tiltmark/ImageTiltmarkLayer';
import { resamplePixelBuffer, syncPixelBufferProxy } from './pixels/highBitTools';

export type CanvasResizeAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type ImageResizeResampleMethod =
  | 'nearest-neighbor'
  | 'bilinear'
  | 'bicubic'
  | 'lanczos3'
  | 'browser-default'
  | 'none';

export type ImageResizeSourceBitDepth = 8 | 16 | 32;

export type ImageResizeOperationKind = 'image-pixel-resize' | 'canvas-resize';

export type ImageResizeOperationWarningCode =
  | 'destructive-pixel-resize'
  | 'transparent-canvas-expansion'
  | 'unsupported-high-bit-depth-preservation';

export interface ImageResizeOperationWarning {
  code: ImageResizeOperationWarningCode;
  severity: 'warning';
  message: string;
}

export interface ImageResizePrintMetadata {
  dpi: number;
  widthInches: number;
  heightInches: number;
  widthMm: number;
  heightMm: number;
}

export interface ImageCanvasTransparentExpansion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ImageResizeOperationDescriptor {
  kind: ImageResizeOperationKind;
  sourceDimensions: ImageDocumentScaleResult;
  targetDimensions: ImageDocumentScaleResult;
  anchor: CanvasResizeAnchor;
  resampleMethod: ImageResizeResampleMethod;
  print: ImageResizePrintMetadata;
  scale: { x: number; y: number };
  canvasOffset?: { x: number; y: number };
  transparentExpansion?: ImageCanvasTransparentExpansion;
  warnings: ImageResizeOperationWarning[];
  preview: {
    signature: string;
    summary: string;
  };
}

export interface ImageDocumentPixelResizePlanOptions {
  printDpi?: number;
  resampleMethod?: Exclude<ImageResizeResampleMethod, 'none'>;
  sourceBitDepth?: ImageResizeSourceBitDepth;
  /** High-bit PixelBuffer authority is resampled natively; no precision-loss warning. */
  nativeHighBitAuthority?: boolean;
}

export interface ImageCanvasResizePlanOptions {
  printDpi?: number;
  sourceBitDepth?: ImageResizeSourceBitDepth;
  /** High-bit PixelBuffer authority remains mounted while canvas bounds move. */
  nativeHighBitAuthority?: boolean;
}

export type ImageDocumentCanvasSizeReadinessState = 'ready' | 'no-op';

export type ImageDocumentCanvasSizeUnsupportedState =
  | 'native-resolution-metadata-editing'
  | 'non-square-pixel-aspect-ratio'
  | 'print-profile-aware-resampling';

export interface ImageDocumentCanvasSizeReadinessOptions {
  printDpi?: number;
  minimumPrintDpi?: number;
  sourceBitDepth?: ImageResizeSourceBitDepth;
  /** True when resizeImageDocumentPixels will resample the document-depth authority. */
  nativeHighBitAuthority?: boolean;
  imageResize?: {
    width: number;
    height: number;
    resampleMethod?: Exclude<ImageResizeResampleMethod, 'none'>;
  };
  canvasResize?: {
    width: number;
    height: number;
    anchor?: CanvasResizeAnchor;
  };
}

export interface ImageDocumentCanvasSizeReadiness {
  kind: 'image-document-canvas-size-readiness';
  sourceDimensions: ImageDocumentScaleResult;
  print: {
    dpi: number;
    minimumDpi: number;
    readyForPrintSize: boolean;
    sourcePrintSize: ImageResizePrintMetadata;
    imageResizePrintSize: ImageResizePrintMetadata;
    canvasResizePrintSize: ImageResizePrintMetadata;
  };
  imageResize: {
    readiness: ImageDocumentCanvasSizeReadinessState;
    targetDimensions: ImageDocumentScaleResult;
    resampleMethod: Exclude<ImageResizeResampleMethod, 'none'>;
    destructiveResize: boolean;
    scale: { x: number; y: number };
    previewSummary: string;
  };
  canvasResize: {
    readiness: ImageDocumentCanvasSizeReadinessState;
    targetDimensions: ImageDocumentScaleResult;
    anchor: CanvasResizeAnchor;
    canvasOffset: { x: number; y: number };
    transparentExpansion: ImageCanvasTransparentExpansion;
    expandsTransparentPixels: boolean;
    previewSummary: string;
  };
  unsupported: {
    states: ImageDocumentCanvasSizeUnsupportedState[];
    highBitDepthCaveat: boolean;
    caveats: string[];
  };
  warningCodes: ImageResizeOperationWarningCode[];
  previewSignatures: {
    imageResize: string;
    canvasResize: string;
  };
  signature: string;
}

export interface ImageDocumentScaleResult {
  width: number;
  height: number;
}

export interface ImageStandaloneCropResizeReadinessOptions {
  printDpi?: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    deleteCroppedPixels?: boolean;
  } | null;
  resize?: {
    width: number;
    height: number;
    resampleMethod?: Exclude<ImageResizeResampleMethod, 'none'>;
  } | null;
  requireSourceBinHandoff?: boolean;
  requireExportHandoff?: boolean;
}

export interface ImageStandaloneCropResizeReadiness {
  kind: 'standalone-crop-resize-readiness';
  status: 'ready' | 'blocked';
  sourceDimensions: ImageDocumentScaleResult;
  crop: {
    status: 'ready' | 'not-requested' | 'blocked-invalid-crop';
    boundsLabel: string;
    outputDimensions: ImageDocumentScaleResult;
    destructive: boolean;
    preservesHiddenPixels: boolean;
  };
  resize: {
    status: 'ready' | 'not-requested' | 'no-op';
    targetDimensions: ImageDocumentScaleResult;
    resampleMethod: Exclude<ImageResizeResampleMethod, 'none'>;
    destructive: boolean;
  };
  print: ImageResizePrintMetadata;
  sourceBinExportHandoff: {
    sourceBinSafe: boolean;
    exportSafe: boolean;
    handoffDimensions: ImageDocumentScaleResult;
  };
  blockers: Array<'invalid-crop-rectangle' | 'source-bin-handoff-blocked' | 'export-handoff-blocked'>;
  batchActionSuitability: {
    suitable: boolean;
    reason: 'fixed-crop-and-resize' | 'resize-only' | 'blocked';
    requiresPerDocumentBoundsValidation: boolean;
  };
  signature: string;
}

const DEFAULT_PRINT_DPI = 72;

export function scaleImageDocumentToPercent(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  percent: number,
): ImageDocumentScaleResult {
  const scale = Math.max(1, percent) / 100;
  return {
    width: clampDocumentDimension(Math.round(doc.width * scale)),
    height: clampDocumentDimension(Math.round(doc.height * scale)),
  };
}

export function planImageDocumentPixelResize(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  width: number,
  height: number,
  options: ImageDocumentPixelResizePlanOptions = {},
): ImageResizeOperationDescriptor {
  const targetDimensions = buildDimensionResult(width, height);
  const sourceDimensions = buildDimensionResult(doc.width, doc.height);
  const warnings: ImageResizeOperationWarning[] = [];

  if (targetDimensions.width !== sourceDimensions.width || targetDimensions.height !== sourceDimensions.height) {
    warnings.push({
      code: 'destructive-pixel-resize',
      severity: 'warning',
      message: 'Image resize resamples layer pixels and masks; original pixel detail is destructively replaced unless this operation is undone.',
    });
  }
  appendHighBitDepthWarning(warnings, options.sourceBitDepth, options.nativeHighBitAuthority);

  return {
    kind: 'image-pixel-resize',
    sourceDimensions,
    targetDimensions,
    anchor: 'center',
    resampleMethod: options.resampleMethod ?? 'browser-default',
    print: buildPrintMetadata(targetDimensions.width, targetDimensions.height, options.printDpi),
    scale: {
      x: roundRatio(targetDimensions.width / sourceDimensions.width),
      y: roundRatio(targetDimensions.height / sourceDimensions.height),
    },
    warnings,
    preview: buildResizePreviewDescriptor({
      kind: 'image-pixel-resize',
      sourceDimensions,
      targetDimensions,
      anchor: 'center',
      resampleMethod: options.resampleMethod ?? 'browser-default',
      dpi: buildPrintMetadata(targetDimensions.width, targetDimensions.height, options.printDpi).dpi,
      scale: {
        x: roundRatio(targetDimensions.width / sourceDimensions.width),
        y: roundRatio(targetDimensions.height / sourceDimensions.height),
      },
      sourceBitDepth: options.sourceBitDepth ?? 8,
    }),
  };
}

export function planImageCanvasResize(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  width: number,
  height: number,
  anchor: CanvasResizeAnchor = 'center',
  options: ImageCanvasResizePlanOptions = {},
): ImageResizeOperationDescriptor {
  const targetDimensions = buildDimensionResult(width, height);
  const sourceDimensions = buildDimensionResult(doc.width, doc.height);
  const offset = canvasAnchorOffset(
    sourceDimensions.width,
    sourceDimensions.height,
    targetDimensions.width,
    targetDimensions.height,
    anchor,
  );
  const canvasOffset = {
    x: roundLayerPosition(offset.x),
    y: roundLayerPosition(offset.y),
  };
  const transparentExpansion = canvasTransparentExpansion(
    sourceDimensions.width,
    sourceDimensions.height,
    targetDimensions.width,
    targetDimensions.height,
    canvasOffset,
  );
  const warnings: ImageResizeOperationWarning[] = [];

  if (hasTransparentExpansion(transparentExpansion)) {
    warnings.push({
      code: 'transparent-canvas-expansion',
      severity: 'warning',
      message: 'Canvas resize will add transparent pixels on the expanded canvas edges; existing layer pixels are not resampled.',
    });
  }
  appendHighBitDepthWarning(warnings, options.sourceBitDepth, options.nativeHighBitAuthority);

  return {
    kind: 'canvas-resize',
    sourceDimensions,
    targetDimensions,
    anchor,
    resampleMethod: 'none',
    print: buildPrintMetadata(targetDimensions.width, targetDimensions.height, options.printDpi),
    scale: { x: 1, y: 1 },
    canvasOffset,
    transparentExpansion,
    warnings,
    preview: buildResizePreviewDescriptor({
      kind: 'canvas-resize',
      sourceDimensions,
      targetDimensions,
      anchor,
      resampleMethod: 'none',
      dpi: buildPrintMetadata(targetDimensions.width, targetDimensions.height, options.printDpi).dpi,
      scale: { x: 1, y: 1 },
      canvasOffset,
      sourceBitDepth: options.sourceBitDepth ?? 8,
    }),
  };
}

export function buildImageDocumentCanvasSizeReadiness(
  doc: Pick<ImageDocument, 'width' | 'height'> & Partial<Pick<ImageDocument, 'layers' | 'metadata'>>,
  options: ImageDocumentCanvasSizeReadinessOptions = {},
): ImageDocumentCanvasSizeReadiness {
  const printDpi = normalizePrintDpi(options.printDpi);
  const minimumDpi = normalizePrintDpi(options.minimumPrintDpi ?? 300);
  const sourceBitDepth = options.sourceBitDepth ?? 8;
  const nativeHighBitAuthority = options.nativeHighBitAuthority
    ?? hasNativeHighBitAuthority(doc, sourceBitDepth);
  const sourceDimensions = buildDimensionResult(doc.width, doc.height);
  const imageResizeTarget = options.imageResize ?? {
    width: sourceDimensions.width,
    height: sourceDimensions.height,
    resampleMethod: 'browser-default' as const,
  };
  const canvasResizeTarget = options.canvasResize ?? {
    width: sourceDimensions.width,
    height: sourceDimensions.height,
    anchor: 'center' as const,
  };
  const imagePlan = planImageDocumentPixelResize(
    sourceDimensions,
    imageResizeTarget.width,
    imageResizeTarget.height,
    {
      printDpi,
      resampleMethod: imageResizeTarget.resampleMethod ?? 'browser-default',
      sourceBitDepth,
      nativeHighBitAuthority,
    },
  );
  const canvasPlan = planImageCanvasResize(
    sourceDimensions,
    canvasResizeTarget.width,
    canvasResizeTarget.height,
    canvasResizeTarget.anchor ?? 'center',
    { printDpi, sourceBitDepth, nativeHighBitAuthority },
  );
  const destructiveResize = imagePlan.warnings.some((warning) => warning.code === 'destructive-pixel-resize');
  const expandsTransparentPixels = Boolean(
    canvasPlan.transparentExpansion && hasTransparentExpansion(canvasPlan.transparentExpansion),
  );
  const warningCodes = uniqueWarningCodes([...imagePlan.warnings, ...canvasPlan.warnings]);
  const unsupportedStates: ImageDocumentCanvasSizeUnsupportedState[] = [
    'native-resolution-metadata-editing',
    'non-square-pixel-aspect-ratio',
    'print-profile-aware-resampling',
  ];
  const highBitDepthCaveat = sourceBitDepth > 8 && !nativeHighBitAuthority;
  const readiness: Omit<ImageDocumentCanvasSizeReadiness, 'signature'> = {
    kind: 'image-document-canvas-size-readiness',
    sourceDimensions,
    print: {
      dpi: printDpi,
      minimumDpi,
      readyForPrintSize: printDpi >= minimumDpi,
      sourcePrintSize: buildPrintMetadata(sourceDimensions.width, sourceDimensions.height, printDpi),
      imageResizePrintSize: imagePlan.print,
      canvasResizePrintSize: canvasPlan.print,
    },
    imageResize: {
      readiness: destructiveResize ? 'ready' : 'no-op',
      targetDimensions: imagePlan.targetDimensions,
      resampleMethod: imagePlan.resampleMethod === 'none' ? 'browser-default' : imagePlan.resampleMethod,
      destructiveResize,
      scale: imagePlan.scale,
      previewSummary: imagePlan.preview.summary,
    },
    canvasResize: {
      readiness: imageDimensionsEqual(sourceDimensions, canvasPlan.targetDimensions) ? 'no-op' : 'ready',
      targetDimensions: canvasPlan.targetDimensions,
      anchor: canvasPlan.anchor,
      canvasOffset: canvasPlan.canvasOffset ?? { x: 0, y: 0 },
      transparentExpansion: canvasPlan.transparentExpansion ?? { left: 0, top: 0, right: 0, bottom: 0 },
      expandsTransparentPixels,
      previewSummary: canvasPlan.preview.summary,
    },
    unsupported: {
      states: unsupportedStates,
      highBitDepthCaveat,
      caveats: buildCanvasSizeUnsupportedCaveats(highBitDepthCaveat),
    },
    warningCodes,
    previewSignatures: {
      imageResize: imagePlan.preview.signature,
      canvasResize: canvasPlan.preview.signature,
    },
  };

  return {
    ...readiness,
    signature: buildImageDocumentCanvasSizeReadinessSignature(readiness, sourceBitDepth),
  };
}

export function buildStandaloneCropResizeReadiness(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  options: ImageStandaloneCropResizeReadinessOptions = {},
): ImageStandaloneCropResizeReadiness {
  const sourceDimensions = buildDimensionResult(doc.width, doc.height);
  const printDpi = normalizePrintDpi(options.printDpi);
  const crop = options.crop ?? null;
  const hasCrop = crop !== null;
  const cropHasPositiveFiniteSize = Boolean(
    crop &&
    Number.isFinite(crop.width) &&
    Number.isFinite(crop.height) &&
    crop.width > 0 &&
    crop.height > 0,
  );
  const cropWithinSourceBounds = Boolean(
    crop &&
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    cropHasPositiveFiniteSize &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.width <= sourceDimensions.width &&
    crop.y + crop.height <= sourceDimensions.height
  );
  const cropValid = Boolean(
    cropHasPositiveFiniteSize && cropWithinSourceBounds,
  );
  const cropOutput = cropHasPositiveFiniteSize && crop
    ? buildDimensionResult(crop.width, crop.height)
    : sourceDimensions;
  const resize = options.resize ?? null;
  const resizeTarget = resize
    ? buildDimensionResult(resize.width, resize.height)
    : cropOutput;
  const resizeDestructive = resize !== null && !imageDimensionsEqual(cropOutput, resizeTarget);
  const handoffDimensions = resize ? resizeTarget : cropOutput;
  const blockers: ImageStandaloneCropResizeReadiness['blockers'] = [];

  if (hasCrop && !cropValid) {
    blockers.push('invalid-crop-rectangle');
  }

  const sourceBinSafe = blockers.length === 0;
  const exportSafe = blockers.length === 0;
  if (options.requireSourceBinHandoff && !sourceBinSafe) {
    blockers.push('source-bin-handoff-blocked');
  }
  if (options.requireExportHandoff && !exportSafe) {
    blockers.push('export-handoff-blocked');
  }

  const status = blockers.length === 0 ? 'ready' : 'blocked';
  const resizeStatus: ImageStandaloneCropResizeReadiness['resize']['status'] = resize
    ? resizeDestructive ? 'ready' : 'no-op'
    : 'not-requested';
  const batchSuitable = status === 'ready';

  return {
    kind: 'standalone-crop-resize-readiness',
    status,
    sourceDimensions,
    crop: {
      status: hasCrop ? cropValid ? 'ready' : 'blocked-invalid-crop' : 'not-requested',
      boundsLabel: cropHasPositiveFiniteSize && crop
        ? `${roundLayerPosition(crop.x)},${roundLayerPosition(crop.y)} ${cropOutput.width}x${cropOutput.height}`
        : 'none',
      outputDimensions: cropOutput,
      destructive: Boolean(crop?.deleteCroppedPixels),
      preservesHiddenPixels: !crop?.deleteCroppedPixels,
    },
    resize: {
      status: resizeStatus,
      targetDimensions: resizeTarget,
      resampleMethod: resize?.resampleMethod ?? 'browser-default',
      destructive: resizeDestructive,
    },
    print: buildPrintMetadata(handoffDimensions.width, handoffDimensions.height, printDpi),
    sourceBinExportHandoff: {
      sourceBinSafe,
      exportSafe,
      handoffDimensions,
    },
    blockers,
    batchActionSuitability: {
      suitable: batchSuitable,
      reason: batchSuitable
        ? hasCrop ? 'fixed-crop-and-resize' : 'resize-only'
        : 'blocked',
      requiresPerDocumentBoundsValidation: hasCrop,
    },
    signature: buildStandaloneCropResizeReadinessSignature({
      status,
      sourceDimensions,
      cropStatus: hasCrop ? cropValid ? 'ready' : 'blocked-invalid-crop' : 'not-requested',
      cropOutput,
      cropDestructive: Boolean(crop?.deleteCroppedPixels),
      resizeStatus,
      resizeTarget,
      resampleMethod: resize?.resampleMethod ?? 'browser-default',
      printDpi,
      handoffDimensions,
      blockers,
    }),
  };
}

function buildResizePreviewDescriptor({
  kind,
  sourceDimensions,
  targetDimensions,
  anchor,
  resampleMethod,
  dpi,
  scale,
  canvasOffset,
  sourceBitDepth,
}: {
  kind: ImageResizeOperationKind;
  sourceDimensions: ImageDocumentScaleResult;
  targetDimensions: ImageDocumentScaleResult;
  anchor: CanvasResizeAnchor;
  resampleMethod: ImageResizeResampleMethod;
  dpi: number;
  scale: { x: number; y: number };
  canvasOffset?: { x: number; y: number };
  sourceBitDepth: ImageResizeSourceBitDepth;
}): ImageResizeOperationDescriptor['preview'] {
  if (kind === 'image-pixel-resize') {
    return {
      signature: [
        kind,
        `${sourceDimensions.width}x${sourceDimensions.height}>${targetDimensions.width}x${targetDimensions.height}`,
        `scale=${scale.x},${scale.y}`,
        `resample=${resampleMethod}`,
        `dpi=${dpi}`,
        `bit=${sourceBitDepth}`,
      ].join('|'),
      summary: `Image resize ${sourceDimensions.width}x${sourceDimensions.height} -> ${targetDimensions.width}x${targetDimensions.height} at ${dpi} DPI using ${resampleMethod} resampling`,
    };
  }

  return {
    signature: [
      kind,
      `${sourceDimensions.width}x${sourceDimensions.height}>${targetDimensions.width}x${targetDimensions.height}`,
      `anchor=${anchor}`,
      `offset=${canvasOffset?.x ?? 0},${canvasOffset?.y ?? 0}`,
      `dpi=${dpi}`,
      `bit=${sourceBitDepth}`,
    ].join('|'),
    summary: `Canvas resize ${sourceDimensions.width}x${sourceDimensions.height} -> ${targetDimensions.width}x${targetDimensions.height} anchored ${anchor} at ${dpi} DPI`,
  };
}

export function resizeImageDocumentPixels(
  doc: ImageDocument,
  width: number,
  height: number,
): ImageDocument {
  const nextWidth = clampDocumentDimension(width);
  const nextHeight = clampDocumentDimension(height);
  if (nextWidth === doc.width && nextHeight === doc.height) return doc;
  // A substrate checkpoint is a physical field at the surface layer's current
  // pixel dimensions. Resampling only its rendered preview would silently turn
  // the retained layer into a stale/corrupt smart object. Require the user's
  // explicit Convert to Raster action before a destructive document resize.
  if (imageDocumentHasPhysicalTiltmarkSurface(doc)) return doc;

  const scaleX = nextWidth / doc.width;
  const scaleY = nextHeight / doc.height;

  return {
    ...doc,
    width: nextWidth,
    height: nextHeight,
    layers: doc.layers.map((layer) => resizeLayerPixels(layer, scaleX, scaleY)),
    dirty: true,
  };
}

export function resizeImageCanvas(
  doc: ImageDocument,
  width: number,
  height: number,
  anchor: CanvasResizeAnchor = 'center',
): ImageDocument {
  const nextWidth = clampDocumentDimension(width);
  const nextHeight = clampDocumentDimension(height);
  if (nextWidth === doc.width && nextHeight === doc.height) return doc;

  const offset = canvasAnchorOffset(doc.width, doc.height, nextWidth, nextHeight, anchor);

  return {
    ...doc,
    width: nextWidth,
    height: nextHeight,
    layers: doc.layers.map((layer) => layer.type === 'group'
      ? layer
      : {
          ...layer,
          x: roundLayerPosition(layer.x + offset.x),
          y: roundLayerPosition(layer.y + offset.y),
        }),
    dirty: true,
  };
}

function resizeLayerPixels(layer: ImageLayer, scaleX: number, scaleY: number): ImageLayer {
  if (layer.type === 'group') return layer;
  const authorityWidth = layer.pixels
    ? clampDocumentDimension(Math.round(layer.pixels.width * scaleX))
    : undefined;
  const authorityHeight = layer.pixels
    ? clampDocumentDimension(Math.round(layer.pixels.height * scaleY))
    : undefined;
  // Native authority is resampled before the legacy proxy. If admission rejects
  // the target shape, this throws before the returned document can be installed.
  const pixels = layer.pixels && authorityWidth !== undefined && authorityHeight !== undefined
    ? resamplePixelBuffer(layer.pixels, authorityWidth, authorityHeight, 'bilinear')
    : layer.pixels;
  const bitmap = layer.bitmap ? resizeBitmap(layer.bitmap, scaleX, scaleY) : null;
  if (pixels && bitmap) syncPixelBufferProxy(pixels, bitmap);
  const mask = layer.mask ? resizeBitmap(layer.mask, scaleX, scaleY) : null;
  const tiltmarkBaseBitmap = layer.tiltmarkBaseBitmap
    ? resizeBitmap(layer.tiltmarkBaseBitmap, scaleX, scaleY)
    : layer.tiltmarkBaseBitmap;
  const bitmapVersion = bitmap || mask || tiltmarkBaseBitmap
    ? layer.bitmapVersion + 1
    : layer.bitmapVersion;

  return {
    ...layer,
    x: roundLayerPosition(layer.x * scaleX),
    y: roundLayerPosition(layer.y * scaleY),
    bitmap,
    pixels,
    pixelsVersion: pixels && layer.pixels
      ? (layer.pixelsVersion ?? layer.bitmapVersion) + 1
      : layer.pixelsVersion,
    mask,
    tiltmarkBaseBitmap,
    bitmapVersion,
    text: layer.text
      ? {
          ...layer.text,
          fontSize: roundTextValue(layer.text.fontSize * Math.max(scaleX, scaleY)),
          boxWidth: layer.text.boxWidth === null ? null : roundTextValue(layer.text.boxWidth * scaleX),
          boxHeight: layer.text.boxHeight === null ? null : roundTextValue(layer.text.boxHeight * scaleY),
        }
      : undefined,
  };
}

function resizeBitmap(bitmap: LayerBitmap, scaleX: number, scaleY: number): LayerBitmap {
  const width = clampDocumentDimension(Math.round(bitmap.width * scaleX));
  const height = clampDocumentDimension(Math.round(bitmap.height * scaleY));
  const resized = new OffscreenCanvas(width, height) as LayerBitmap;
  const context = resized.getContext('2d');
  if (!context) {
    throw new Error('Failed to acquire 2D context for resized image layer');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return resized;
}

function canvasAnchorOffset(
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
  anchor: CanvasResizeAnchor,
): { x: number; y: number } {
  const dx = newWidth - oldWidth;
  const dy = newHeight - oldHeight;

  const x =
    anchor.endsWith('right') || anchor === 'right'
      ? dx
      : anchor === 'center' || anchor === 'top' || anchor === 'bottom'
        ? dx / 2
        : 0;
  const y =
    anchor.startsWith('bottom') || anchor === 'bottom'
      ? dy
      : anchor === 'center' || anchor === 'left' || anchor === 'right'
        ? dy / 2
        : 0;

  return { x, y };
}

function canvasTransparentExpansion(
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
  offset: { x: number; y: number },
): ImageCanvasTransparentExpansion {
  return {
    left: roundLayerPosition(Math.max(0, offset.x)),
    top: roundLayerPosition(Math.max(0, offset.y)),
    right: roundLayerPosition(Math.max(0, newWidth - oldWidth - offset.x)),
    bottom: roundLayerPosition(Math.max(0, newHeight - oldHeight - offset.y)),
  };
}

function clampDocumentDimension(value: number): number {
  return Math.max(1, Math.min(32768, Math.round(value)));
}

function buildDimensionResult(width: number, height: number): ImageDocumentScaleResult {
  return {
    width: clampDocumentDimension(width),
    height: clampDocumentDimension(height),
  };
}

function buildPrintMetadata(width: number, height: number, dpi: number = DEFAULT_PRINT_DPI): ImageResizePrintMetadata {
  const normalizedDpi = normalizePrintDpi(dpi);
  const widthInches = roundPrintValue(width / normalizedDpi);
  const heightInches = roundPrintValue(height / normalizedDpi);

  return {
    dpi: normalizedDpi,
    widthInches,
    heightInches,
    widthMm: roundPrintValue(widthInches * 25.4),
    heightMm: roundPrintValue(heightInches * 25.4),
  };
}

function normalizePrintDpi(dpi: number = DEFAULT_PRINT_DPI): number {
  return Number.isFinite(dpi) ? Math.max(1, Math.round(dpi)) : DEFAULT_PRINT_DPI;
}

function appendHighBitDepthWarning(
  warnings: ImageResizeOperationWarning[],
  sourceBitDepth: ImageResizeSourceBitDepth | undefined,
  nativeHighBitAuthority = false,
) {
  if (!sourceBitDepth || sourceBitDepth <= 8 || nativeHighBitAuthority) return;
  warnings.push({
    code: 'unsupported-high-bit-depth-preservation',
    severity: 'warning',
    message: `${sourceBitDepth}-bit per-channel source precision cannot be preserved by the current 8-bit RGBA browser raster pipeline.`,
  });
}

function hasNativeHighBitAuthority(
  doc: Pick<ImageDocument, 'width' | 'height'> & Partial<Pick<ImageDocument, 'layers' | 'metadata'>>,
  sourceBitDepth: ImageResizeSourceBitDepth,
): boolean {
  if (sourceBitDepth <= 8 || !doc.layers) return false;
  const expectedDepth = sourceBitDepth === 16 ? 'u16' : 'f32';
  return doc.layers.some((layer) => layer.type !== 'group' && layer.pixels?.depth === expectedDepth);
}

function hasTransparentExpansion(expansion: ImageCanvasTransparentExpansion): boolean {
  return expansion.left > 0 || expansion.top > 0 || expansion.right > 0 || expansion.bottom > 0;
}

function uniqueWarningCodes(warnings: ImageResizeOperationWarning[]): ImageResizeOperationWarningCode[] {
  return Array.from(new Set(warnings.map((warning) => warning.code)));
}

function imageDimensionsEqual(
  first: ImageDocumentScaleResult,
  second: ImageDocumentScaleResult,
): boolean {
  return first.width === second.width && first.height === second.height;
}

function buildCanvasSizeUnsupportedCaveats(highBitDepthCaveat: boolean): string[] {
  const caveats = [
    'Native Photoshop-style resolution metadata editing is not represented separately from the requested DPI planning metadata.',
    'Non-square pixel aspect ratios are unsupported; canvas and print dimensions assume square pixels.',
    'ICC/profile-aware resampling and print-intent interpolation are not implemented in the browser raster pipeline.',
  ];
  if (highBitDepthCaveat) {
    caveats.push('16-bit and 32-bit sources are planned honestly, but current canvas execution preserves only 8-bit RGBA precision.');
  }
  return caveats;
}

function buildImageDocumentCanvasSizeReadinessSignature(
  readiness: Omit<ImageDocumentCanvasSizeReadiness, 'signature'>,
  sourceBitDepth: ImageResizeSourceBitDepth,
): string {
  const expansion = readiness.canvasResize.transparentExpansion;
  return [
    'image-document-canvas-size-readiness:v1',
    `source=${readiness.sourceDimensions.width}x${readiness.sourceDimensions.height}`,
    `dpi=${readiness.print.dpi}/${readiness.print.minimumDpi}`,
    `print=${readiness.print.readyForPrintSize}`,
    `image=${readiness.imageResize.targetDimensions.width}x${readiness.imageResize.targetDimensions.height}:${readiness.imageResize.resampleMethod}:destructive=${readiness.imageResize.destructiveResize}`,
    `canvas=${readiness.canvasResize.targetDimensions.width}x${readiness.canvasResize.targetDimensions.height}:${readiness.canvasResize.anchor}:offset=${readiness.canvasResize.canvasOffset.x},${readiness.canvasResize.canvasOffset.y}:transparent=${expansion.left},${expansion.top},${expansion.right},${expansion.bottom}`,
    `bit=${sourceBitDepth}`,
    `warnings=${readiness.warningCodes.join(',') || 'none'}`,
    `unsupported=${readiness.unsupported.states.join(',')}`,
  ].join('|');
}

function buildStandaloneCropResizeReadinessSignature({
  status,
  sourceDimensions,
  cropStatus,
  cropOutput,
  cropDestructive,
  resizeStatus,
  resizeTarget,
  resampleMethod,
  printDpi,
  handoffDimensions,
  blockers,
}: {
  status: ImageStandaloneCropResizeReadiness['status'];
  sourceDimensions: ImageDocumentScaleResult;
  cropStatus: ImageStandaloneCropResizeReadiness['crop']['status'];
  cropOutput: ImageDocumentScaleResult;
  cropDestructive: boolean;
  resizeStatus: ImageStandaloneCropResizeReadiness['resize']['status'];
  resizeTarget: ImageDocumentScaleResult;
  resampleMethod: Exclude<ImageResizeResampleMethod, 'none'>;
  printDpi: number;
  handoffDimensions: ImageDocumentScaleResult;
  blockers: ImageStandaloneCropResizeReadiness['blockers'];
}): string {
  return [
    'standalone-crop-resize-readiness:v1',
    `status=${status}`,
    `source=${sourceDimensions.width}x${sourceDimensions.height}`,
    `crop=${cropStatus}:${cropOutput.width}x${cropOutput.height}:destructive=${cropDestructive}`,
    `resize=${resizeStatus}:${resizeTarget.width}x${resizeTarget.height}:${resampleMethod}`,
    `handoff=${handoffDimensions.width}x${handoffDimensions.height}`,
    `dpi=${printDpi}`,
    `blockers=${blockers.join(',') || 'none'}`,
  ].join('|');
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPrintValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundLayerPosition(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundTextValue(value: number): number {
  return Math.round(value * 100) / 100;
}
