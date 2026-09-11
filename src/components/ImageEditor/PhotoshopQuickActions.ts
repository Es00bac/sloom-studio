import type { ImageDocument } from '../../types/imageEditor';
import { canEditImageLayerPixels, canMoveImageLayer } from '../../lib/imageLayerLocks';
import type { SelectionMask } from './SelectionMask';
// Import via the explicit '/index' path: this file (PhotoshopQuickActions.ts) case-collides
// with the sibling ./photoshopQuickActions/ directory on case-insensitive filesystems (macOS,
// Windows). A bare './photoshopQuickActions' specifier resolves back to THIS file there instead
// of the directory barrel, dropping PHOTOSHOP_QUICK_ACTIONS and cascading into build errors.
import {
  getPhotoshopQuickActionCapabilityDescriptor as getBasePhotoshopQuickActionCapabilityDescriptor,
  planLocalContentAwareFillPatch,
  type PhotoshopQuickActionCapabilityDescriptor,
} from './photoshopQuickActions/index';
import type {
  LocalContentAwareBounds,
  LocalContentAwarePatchTargetKind,
  LocalContentAwareReadiness,
  LocalContentAwareRepairOperation,
  LocalContentAwareRequestedOutputTarget,
} from './ImageContentAware';

export * from './photoshopQuickActions/index'; // explicit '/index' — case-collision, see note above

export interface PhotoshopContentAwareQuickActionCompatibility {
  operation: LocalContentAwareRepairOperation;
  targetKind: LocalContentAwarePatchTargetKind;
  readinessState: LocalContentAwareReadiness['state'];
  activeLayerExecutable: boolean;
  targetPixels: number;
  sourcePixels: number;
  blockerCodes: string[];
  requestedOutputTarget: LocalContentAwareRequestedOutputTarget;
  appliedOutputTarget: LocalContentAwareRequestedOutputTarget;
  outputCreatesLayer: boolean;
  nonDestructive: boolean;
  samplingRegionSignature: string;
  operationSignature: string;
  outputPolicySignature: string;
  previewSignature: string;
}

export interface PhotoshopQuickActionCompatibilityDescriptor {
  descriptorId: 'photoshop-quick-action-compatibility:v1';
  actionId: string;
  documentId: string;
  activeLayerId: string | null;
  knownAction: boolean;
  category: PhotoshopQuickActionCapabilityDescriptor['category'] | null;
  output: PhotoshopQuickActionCapabilityDescriptor['output'] | null;
  implementation: PhotoshopQuickActionCapabilityDescriptor['implementation'] | null;
  compatible: boolean;
  blockerCodes: string[];
  warnings: string[];
  contentAwareRepair: PhotoshopContentAwareQuickActionCompatibility | null;
  previewSignature: string;
}

export function describePhotoshopQuickActionCompatibility({
  actionId,
  doc,
  selection,
  operation = 'fill',
  outputTarget = 'active-layer',
  maxSampleRadius,
  manualPatchSource,
}: {
  actionId: string;
  doc: ImageDocument;
  selection?: SelectionMask | null;
  operation?: LocalContentAwareRepairOperation;
  outputTarget?: LocalContentAwareRequestedOutputTarget;
  maxSampleRadius?: number;
  manualPatchSource?: LocalContentAwareBounds | null;
}): PhotoshopQuickActionCompatibilityDescriptor {
  const descriptor = getBasePhotoshopQuickActionCapabilityDescriptor(actionId);
  const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId) ?? null;
  const blockerCodes: string[] = [];
  const warnings = descriptor?.warning ? [descriptor.warning] : [];

  if (!descriptor) {
    blockerCodes.push('missing-from-registry');
  } else {
    if (descriptor.input.some((input) => input === 'activeLayer' || input === 'editablePixels' || input === 'movableLayer') && !layer) {
      blockerCodes.push('missing-active-layer');
    }
    if (descriptor.input.includes('editablePixels') && layer && !canEditImageLayerPixels(layer)) {
      blockerCodes.push('active-layer-not-editable');
    }
    if (descriptor.input.includes('movableLayer') && layer && !canMoveImageLayer(layer)) {
      blockerCodes.push('active-layer-not-movable');
    }
    if (descriptor.input.includes('selection') && !selection) {
      blockerCodes.push('missing-selection');
    }
  }

  let contentAwareRepair: PhotoshopContentAwareQuickActionCompatibility | null = null;
  if (actionId === 'localContentAwareFillPatch') {
    if (layer && canEditImageLayerPixels(layer)) {
      const plan = planLocalContentAwareFillPatch(doc, layer, selection, {
        operation,
        outputTarget,
        maxSampleRadius,
        manualPatchSource,
      });

      if (plan) {
        const repairBlockers = plan.invalidSelectionBlockers.map((blocker) => blocker.code);
        const outputBlockers = [...plan.outputLayerPolicy.blockerCodes];
        blockerCodes.push(...repairBlockers, ...outputBlockers);
        contentAwareRepair = {
          operation: plan.operation,
          targetKind: plan.targetKind,
          readinessState: plan.readiness.state,
          activeLayerExecutable: repairBlockers.length === 0,
          targetPixels: plan.targetPixels,
          sourcePixels: plan.sourcePixels.sampledPixels,
          blockerCodes: repairBlockers,
          requestedOutputTarget: plan.requestedOutputTarget,
          appliedOutputTarget: plan.outputTarget,
          outputCreatesLayer: plan.outputLayerPolicy.createsLayer,
          nonDestructive: plan.outputLayerPolicy.nonDestructive,
          samplingRegionSignature: plan.samplingRegionPlan.signature,
          operationSignature: plan.operationDescriptor.signature,
          outputPolicySignature: plan.outputLayerPolicy.signature,
          previewSignature: plan.stablePreview.signature,
        };
      } else {
        blockerCodes.push('active-layer-has-no-bitmap');
      }
    }
  }

  const uniqueBlockerCodes = [...new Set(blockerCodes)];
  const previewPayload = {
    actionId,
    documentId: doc.id,
    activeLayerId: doc.activeLayerId,
    blockerCodes: uniqueBlockerCodes,
    contentAwareRepair: contentAwareRepair
      ? {
          operation: contentAwareRepair.operation,
          targetKind: contentAwareRepair.targetKind,
          readinessState: contentAwareRepair.readinessState,
          samplingRegionSignature: contentAwareRepair.samplingRegionSignature,
          operationSignature: contentAwareRepair.operationSignature,
          outputPolicySignature: contentAwareRepair.outputPolicySignature,
        }
      : null,
  };

  return {
    descriptorId: 'photoshop-quick-action-compatibility:v1',
    actionId,
    documentId: doc.id,
    activeLayerId: doc.activeLayerId,
    knownAction: Boolean(descriptor),
    category: descriptor?.category ?? null,
    output: descriptor?.output ?? null,
    implementation: descriptor?.implementation ?? null,
    compatible: Boolean(descriptor) && uniqueBlockerCodes.length === 0,
    blockerCodes: uniqueBlockerCodes,
    warnings,
    contentAwareRepair,
    previewSignature: `photoshop-quick-action-compatibility:v1:${JSON.stringify(previewPayload)}`,
  };
}
