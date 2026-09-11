import type { ImageDocument } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { toSnapshot } from './SelectionMask';
import { applyOperation } from './undoRedoApply';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import {
  createPhotoshopQuickActionResult,
  describePhotoshopQuickActionCompatibility,
  getPhotoshopQuickActionCapabilityDescriptor,
  type PhotoshopQuickActionId,
} from './PhotoshopQuickActions';
import { rasterizeSvgToBitmapAtResolution } from './ImageFileFormats';
import type {
  LocalContentAwareBounds,
  LocalContentAwarePatchTargetKind,
  LocalContentAwareRepairOperation,
  LocalContentAwareRequestedOutputTarget,
} from './ImageContentAware';

export interface PhotoshopQuickActionAutomationDescriptor {
  descriptorId: 'photoshop-quick-action-automation:v1';
  automationSurface: {
    workspaceId: 'image-automation';
    separateFromMainFlow: true;
    scope: 'open-document-quick-actions';
  };
  callableOperations: Array<{
    kind: 'quick-action';
    id: string;
    callable: boolean;
    source: 'suite-native-quick-action';
    reason?: 'missing-from-registry';
  }>;
  variableBindingReadiness: {
    state: 'ready-for-explicit-review';
    supportsActionIdBinding: true;
    supportsArbitraryJsExpressions: false;
  };
  dryRunDiagnostics: {
    safe: true;
    canMutateDocuments: false;
    documentCount: number;
    actionableDocumentCount: number;
    blockedDocumentCount: number;
    blockedDocumentIds: string[];
  };
  contentAwareRepairCompatibility?: {
    requested: true;
    actionIds: string[];
    batchSuitable: boolean;
    documents: Array<{
      docId: string;
      actionId: string;
      compatible: boolean;
      targetKind: string | null;
      operation: string | null;
      readinessState: string | null;
      outputTarget: string | null;
      blockerCodes: string[];
      previewSignature: string | null;
    }>;
  };
}

export function buildPhotoshopQuickActionAutomationDescriptor(input: {
  actionIds: readonly string[];
  documents: readonly ImageDocument[];
  activeDocId: string | null;
}): PhotoshopQuickActionAutomationDescriptor {
  const callableOperations = input.actionIds.map((actionId) => {
    const descriptor = getPhotoshopQuickActionCapabilityDescriptor(actionId);
    return descriptor
      ? {
          kind: 'quick-action' as const,
          id: actionId,
          callable: true as const,
          source: 'suite-native-quick-action' as const,
        }
      : {
          kind: 'quick-action' as const,
          id: actionId,
          callable: false as const,
          source: 'suite-native-quick-action' as const,
          reason: 'missing-from-registry' as const,
        };
  });

  const hasCallableActions = callableOperations.some((operation) => operation.callable);
  const actionableDescriptors = callableOperations
    .filter((operation) => operation.callable)
    .map((operation) => getPhotoshopQuickActionCapabilityDescriptor(operation.id))
    .filter((descriptor) => descriptor !== null);
  const contentAwareRepairCompatibility = buildContentAwareRepairCompatibility(
    input.actionIds.filter((actionId) => actionId === 'localContentAwareFillPatch'),
    input.documents,
  );
  const contentAwareBlockedDocumentIds = new Set(
    contentAwareRepairCompatibility?.documents
      .filter((documentCompatibility) => !documentCompatibility.compatible)
      .map((documentCompatibility) => documentCompatibility.docId) ?? [],
  );
  const blockedDocumentIds = input.documents
    .filter((doc) => {
      if (!hasCallableActions) return true;
      const missingRequiredActiveLayer = actionableDescriptors.some((descriptor) => (
        descriptor.input.includes('activeLayer') || descriptor.input.includes('editablePixels') || descriptor.input.includes('movableLayer')
      )) && !doc.activeLayerId;
      return missingRequiredActiveLayer || contentAwareBlockedDocumentIds.has(doc.id);
    })
    .map((doc) => doc.id);

  const descriptor: PhotoshopQuickActionAutomationDescriptor = {
    descriptorId: 'photoshop-quick-action-automation:v1',
    automationSurface: {
      workspaceId: 'image-automation',
      separateFromMainFlow: true,
      scope: 'open-document-quick-actions',
    },
    callableOperations,
    variableBindingReadiness: {
      state: 'ready-for-explicit-review',
      supportsActionIdBinding: true,
      supportsArbitraryJsExpressions: false,
    },
    dryRunDiagnostics: {
      safe: true,
      canMutateDocuments: false,
      documentCount: input.documents.length,
      actionableDocumentCount: input.documents.length - blockedDocumentIds.length,
      blockedDocumentCount: blockedDocumentIds.length,
      blockedDocumentIds,
    },
  };

  if (contentAwareRepairCompatibility) {
    descriptor.contentAwareRepairCompatibility = contentAwareRepairCompatibility;
  }

  return descriptor;
}

function buildContentAwareRepairCompatibility(
  actionIds: string[],
  documents: readonly ImageDocument[],
): PhotoshopQuickActionAutomationDescriptor['contentAwareRepairCompatibility'] | undefined {
  if (actionIds.length === 0) return undefined;

  const documentCompatibilities = documents.flatMap((doc) =>
    actionIds.map((actionId) => {
      const compatibility = describePhotoshopQuickActionCompatibility({ actionId, doc });
      return {
        docId: doc.id,
        actionId,
        compatible: compatibility.compatible,
        targetKind: compatibility.contentAwareRepair?.targetKind ?? null,
        operation: compatibility.contentAwareRepair?.operation ?? null,
        readinessState: compatibility.contentAwareRepair?.readinessState ?? null,
        outputTarget: compatibility.contentAwareRepair?.appliedOutputTarget ?? null,
        blockerCodes: compatibility.blockerCodes,
        previewSignature: compatibility.contentAwareRepair?.previewSignature ?? null,
      };
    }),
  );

  return {
    requested: true,
    actionIds,
    batchSuitable: documentCompatibilities.every((compatibility) => compatibility.compatible),
    documents: documentCompatibilities,
  };
}

export function runPhotoshopQuickAction(
  actionId: PhotoshopQuickActionId,
  options: {
    createLayerId?: () => string;
    skipRecording?: boolean;
    contentAware?: {
      operation?: LocalContentAwareRepairOperation;
      targetKind?: LocalContentAwarePatchTargetKind;
      maxSampleRadius?: number;
      manualPatchSource?: LocalContentAwareBounds | null;
      outputTarget?: LocalContentAwareRequestedOutputTarget;
    };
  } = {},
): boolean {
  const state = useImageEditorStore.getState();
  const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
  if (!doc) return false;

  const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId) ?? null;
  const beforeSelection = getSelection(doc.id) ?? null;

  // Track vector layer sizes before the action runs
  const beforeVectorSizes = new Map<string, { width: number; height: number }>();
  doc.layers.forEach((l) => {
    if (l.type === 'vector' && l.bitmap) {
      beforeVectorSizes.set(l.id, { width: l.bitmap.width, height: l.bitmap.height });
    }
  });

  const result = createPhotoshopQuickActionResult({
    actionId,
    doc,
    layer,
    selection: beforeSelection,
    createLayerId: options.createLayerId,
    contentAware: options.contentAware,
  });

  if (!result) return false;

  switch (result.kind) {
    case 'selection': {
      state.pushOperation({
        kind: 'selection',
        docId: doc.id,
        before: beforeSelection ? toSnapshot(beforeSelection) : null,
        after: result.hasSelection ? toSnapshot(result.selection) : null,
      });

      if (result.hasSelection) {
        setSelection(doc.id, result.selection);
      } else {
        clearSelection(doc.id);
      }

      useImageEditorStore.getState().setHasSelection(doc.id, result.hasSelection);
      maybeRecordQuickAction(actionId, options.skipRecording);
      return true;
    }
    case 'paint':
    case 'transform':
    case 'docResize':
      state.pushOperation(result.operation);
      applyOperation(result.operation, 'redo');
      regenerateVectorLayersIfNeeded(doc.id, beforeVectorSizes);
      maybeRecordQuickAction(actionId, options.skipRecording);
      return true;
    case 'layerOp':
      state.pushOperation(result.operation);
      applyOperation(result.operation, 'redo');
      if (result.activeLayerId) {
        useImageEditorStore.getState().setActiveLayer(doc.id, result.activeLayerId);
      }
      regenerateVectorLayersIfNeeded(doc.id, beforeVectorSizes);
      maybeRecordQuickAction(actionId, options.skipRecording);
      return true;
  }
}

function maybeRecordQuickAction(actionId: PhotoshopQuickActionId, skipRecording = false): void {
  if (skipRecording) return;
  useImageEditorStore.getState().appendQuickActionRecordingStep(actionId);
}

function regenerateVectorLayersIfNeeded(
  docId: string,
  beforeVectorSizes: Map<string, { width: number; height: number }>,
): void {
  const store = useImageEditorStore.getState();
  const currentDoc = store.documents.find((d) => d.id === docId);
  if (!currentDoc) return;

  currentDoc.layers.forEach((layer) => {
    const svgSource = layer.vectorRecipe || layer.metadata?.originalSvgSource;
    if (layer.type === 'vector' && svgSource && layer.bitmap) {
      const beforeSize = beforeVectorSizes.get(layer.id);
      const targetWidth = layer.bitmap.width;
      const targetHeight = layer.bitmap.height;

      // Regenerate if size changed, or if it's new
      if (!beforeSize || beforeSize.width !== targetWidth || beforeSize.height !== targetHeight) {
        rasterizeSvgToBitmapAtResolution(svgSource, targetWidth, targetHeight)
          .then((newBitmap) => {
            const freshStore = useImageEditorStore.getState();
            const freshDoc = freshStore.documents.find((d) => d.id === docId);
            if (freshDoc) {
              const updatedLayers = freshDoc.layers.map((l) =>
                l.id === layer.id
                  ? {
                      ...l,
                      bitmap: newBitmap,
                      bitmapVersion: l.bitmapVersion + 1,
                      vectorRecipe: l.vectorRecipe || svgSource,
                      metadata: {
                        ...l.metadata,
                        originalSvgSource: l.metadata?.originalSvgSource || svgSource,
                        sourceLink: l.metadata?.sourceLink
                          ? { ...l.metadata.sourceLink, width: targetWidth, height: targetHeight }
                          : { id: l.id, status: 'linked' as const, width: targetWidth, height: targetHeight, relinkHistory: [] },
                      },
                    }
                  : l
              );
              freshStore.setLayers(docId, updatedLayers, freshDoc.activeLayerId);
            }
          })
          .catch((err) => {
            console.error('Failed to regenerate vector layer bitmap in quick action:', err);
          });
      }
    }
  });
}
