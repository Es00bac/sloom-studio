import { useImageEditorStore } from '../../store/imageEditorStore';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { bitmapFromUrl, createBitmap } from './LayerBitmap';
import { loadSourceLinkedLayerBitmap } from './ImageSourceDocument';

/**
 * Scale factor to draw a `srcW x srcH` bitmap into a `maxW x maxH` canvas:
 * shrink to contain (preserving aspect ratio) only when it is larger than the
 * canvas in either dimension; otherwise place it at native size (scale 1).
 */
export function computeContainScale(srcW: number, srcH: number, maxW: number, maxH: number): number {
  if (srcW <= 0 || srcH <= 0 || maxW <= 0 || maxH <= 0) return 1;
  if (srcW <= maxW && srcH <= maxH) return 1;
  return Math.min(maxW / srcW, maxH / srcH);
}

let layerInsertCounter = 0;

/** Add an existing layer to the active document, recording one undoable op. */
export function addImageLayerUndoable(layer: ImageLayer): ImageLayer | null {
  const store = useImageEditorStore.getState();
  const doc = store.getActiveDocument();
  if (!doc) return null;
  if ((doc.metadata?.bitDepth === 16 || doc.metadata?.bitDepth === 32) && layer.type === 'adjustment') {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', { detail: {
      code: 'high-bit-adjustment-refused',
      bitDepth: doc.metadata.bitDepth,
      message: `Refused before mutation: ${doc.metadata.bitDepth}-bit adjustment processing has no native round-trip authority; no pixels or history were changed.`,
    } }));
    return null;
  }
  const before = doc.layers;
  store.addLayer(doc.id, layer); // addLayer also makes the new layer active
  const after = useImageEditorStore.getState().documents.find((d) => d.id === doc.id)?.layers;
  if (after) store.pushOperation({ kind: 'layerOp', docId: doc.id, before, after });
  return layer;
}

/**
 * Build an image layer from a Source Bin item, fitted into the given canvas:
 * scaled down to contain when larger than the canvas, centred either way.
 */
export async function buildSourceItemImageLayer(
  item: SourceBinLibraryItem,
  canvasWidth: number,
  canvasHeight: number,
  loadBitmap: (url: string) => Promise<LayerBitmap> = bitmapFromUrl,
): Promise<ImageLayer> {
  const source = await loadSourceLinkedLayerBitmap(item, loadBitmap);
  const scale = computeContainScale(source.width, source.height, canvasWidth, canvasHeight);
  const targetW = Math.max(1, Math.round(source.width * scale));
  const targetH = Math.max(1, Math.round(source.height * scale));
  const bitmap = createBitmap(targetW, targetH);
  bitmap.getContext('2d')?.drawImage(source, 0, 0, targetW, targetH);
  layerInsertCounter += 1;
  return {
    id: `layer-source-${Date.now()}-${layerInsertCounter}`,
    name: item.label ?? 'Image Layer',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: Math.round((canvasWidth - targetW) / 2),
    y: Math.round((canvasHeight - targetH) / 2),
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

/**
 * Insert a Source Bin image item as a new, fitted layer in the active document.
 * Returns the new layer, or `null` when there is no active document or the item
 * has no loadable image (the caller falls back to opening a new document).
 */
export async function insertSourceItemAsImageLayer(
  item: SourceBinLibraryItem,
  doc: ImageDocument,
  loadBitmap: (url: string) => Promise<LayerBitmap> = bitmapFromUrl,
): Promise<ImageLayer | null> {
  const layer = await buildSourceItemImageLayer(item, doc.width, doc.height, loadBitmap);
  return addImageLayerUndoable(layer);
}
