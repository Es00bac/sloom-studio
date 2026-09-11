import type { ImageDocument } from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { maskToCanvas, type SelectionMask } from './SelectionMask';
import {
  cropSelectionToBounds,
  describeGenerativeFillPlacementPlan,
  type GenerativeFillPlacementBounds,
} from './GenerativeFillGeometry';

export interface GenerativeFillRequestArtifactManifest {
  descriptorId: 'generative-fill-request-artifacts:v1';
  documentId: string;
  documentSize: {
    width: number;
    height: number;
  };
  placementBounds: GenerativeFillPlacementBounds;
  selectionBounds: GenerativeFillPlacementBounds | null;
  localSelectionBounds: GenerativeFillPlacementBounds | null;
  selectedPixels: number;
  source: {
    mimeType: 'image/png';
    width: number;
    height: number;
  };
  mask: {
    mimeType: 'image/png';
    width: number;
    height: number;
  };
  previewSignature: string;
}

export interface GenerativeFillRequestArtifacts {
  source: Blob;
  mask: Blob;
  placementBounds: GenerativeFillPlacementBounds;
  manifest: GenerativeFillRequestArtifactManifest;
}

const GENERATIVE_FILL_CONTEXT_PADDING_PX = 96;

export async function buildGenerativeFillRequestArtifacts(
  doc: ImageDocument,
  selection: SelectionMask,
): Promise<GenerativeFillRequestArtifacts> {
  const plan = describeGenerativeFillPlacementPlan(doc, selection, GENERATIVE_FILL_CONTEXT_PADDING_PX);
  const placementBounds = plan.placementBounds;
  const flattened = renderImageDocumentLayersToBitmap(doc);
  const sourceCanvas = createBitmap(placementBounds.width, placementBounds.height);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) throw new Error('Failed to acquire 2D context for generative fill source.');

  sourceCtx.drawImage(
    flattened,
    placementBounds.x,
    placementBounds.y,
    placementBounds.width,
    placementBounds.height,
    0,
    0,
    placementBounds.width,
    placementBounds.height,
  );

  const localSelection = cropSelectionToBounds(selection, placementBounds);
  const maskCanvas = maskToCanvas(localSelection, 255, 255, 255);
  const source = await sourceCanvas.convertToBlob({ type: 'image/png' });
  const mask = await maskCanvas.convertToBlob({ type: 'image/png' });

  return {
    source,
    mask,
    placementBounds,
    manifest: buildGenerativeFillRequestArtifactManifest(doc, plan),
  };
}

function buildGenerativeFillRequestArtifactManifest(
  doc: ImageDocument,
  plan: ReturnType<typeof describeGenerativeFillPlacementPlan>,
): GenerativeFillRequestArtifactManifest {
  const payload = {
    documentId: doc.id,
    placementBounds: plan.placementBounds,
    selectionBounds: plan.selection.bounds,
    selectedPixels: plan.selection.selectedPixels,
    source: {
      width: plan.artifacts.source.width,
      height: plan.artifacts.source.height,
    },
    mask: {
      width: plan.artifacts.mask.width,
      height: plan.artifacts.mask.height,
    },
  };

  return {
    descriptorId: 'generative-fill-request-artifacts:v1',
    documentId: doc.id,
    documentSize: plan.documentSize,
    placementBounds: plan.placementBounds,
    selectionBounds: plan.selection.bounds,
    localSelectionBounds: plan.localSelectionBounds,
    selectedPixels: plan.selection.selectedPixels,
    source: plan.artifacts.source,
    mask: plan.artifacts.mask,
    previewSignature: `generative-fill-request-artifacts:v1:${JSON.stringify(payload)}`,
  };
}
