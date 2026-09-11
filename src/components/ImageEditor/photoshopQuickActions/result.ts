import type { ImageDocument, ImageLayer } from '../../../types/imageEditor';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import type { SelectionMask } from '../SelectionMask';
import { generatedQuickActionById } from './catalog';
import type {
  GeneratedQuickActionDefinition,
  PhotoshopQuickActionId,
  PhotoshopQuickActionResult,
} from './types';
import {
  buildLayerOpResult,
  buildSelectionResult,
  buildTransformResult,
  applyLayerReplacement,
  setLayerBlendModeResult,
  setLayerOpacityResult,
} from './resultBuilders';
import {
  borderSelection,
  featherSelection,
  growSelection,
  nudgeSelection,
  selectBorderRingPercent,
  selectBottomHalf,
  selectCanvas,
  selectCenterSquare,
  selectEdgeStripPercent,
  selectGridCell,
  selectHorizontalCenterBand,
  selectInsetPercent,
  selectLayerBounds,
  selectLayerOpaquePixels,
  selectLayerTransparentPixels,
  selectLeftHalf,
  selectRightHalf,
  selectSelectionBoundingBox,
  selectTopHalf,
  selectVerticalCenterBand,
  shrinkSelection,
  smoothSelection,
} from './selectionActions';
import {
  adjustLayerBrightness,
  clearOutsideSelection,
  clearSelectedPixels,
  desaturateLayer,
  invertLayerColors,
  createLocalContentAwareFillLayer,
  localContentAwareFillPatch,
  setLayerPixelAlphaPercent,
} from './pixelActions';
import {
  alignLayerBottom,
  alignLayerLeft,
  alignLayerRight,
  alignLayerTop,
  centerLayer,
  centerLayerHorizontal,
  centerLayerVertical,
  createLayerViaCopy,
  createLayerViaCut,
  cropLayerToSelection,
  duplicateLayerQuickAction,
  fillLayerToCanvas,
  fitLayerHeightToCanvas,
  fitLayerInsideCanvas,
  fitLayerToCanvas,
  fitLayerWidthToCanvas,
  flipLayerHorizontal,
  flipLayerVertical,
  lowerLayerOneStep,
  moveLayerToBack,
  moveLayerToFront,
  nudgeLayer,
  raiseLayerOneStep,
  rasterizeLayerToCanvas,
  resetLayerPosition,
  rotateLayer180,
  rotateLayer90Clockwise,
  rotateLayer90CounterClockwise,
  scaleLayerByPercent,
  trimCanvasToVisible,
  trimTransparentLayer,
} from './layerActions';
import { insertLayerAfter, replaceLayer } from './layerStack';
import type {
  LocalContentAwareBounds,
  LocalContentAwarePatchTargetKind,
  LocalContentAwareRepairOperation,
  LocalContentAwareRequestedOutputTarget,
} from '../ImageContentAware';

export function createPhotoshopQuickActionResult({
  actionId,
  doc,
  layer,
  selection,
  createLayerId = () => `quick-action-layer-${Date.now()}`,
  contentAware,
}: {
  actionId: PhotoshopQuickActionId;
  doc: ImageDocument;
  layer: ImageLayer | null | undefined;
  selection?: SelectionMask | null;
  createLayerId?: () => string;
  contentAware?: {
    operation?: LocalContentAwareRepairOperation;
    targetKind?: LocalContentAwarePatchTargetKind;
    maxSampleRadius?: number;
    manualPatchSource?: LocalContentAwareBounds | null;
    outputTarget?: LocalContentAwareRequestedOutputTarget;
  };
}): PhotoshopQuickActionResult | null {
  const generatedAction = generatedQuickActionById.get(actionId);
  if (generatedAction) {
    return createGeneratedQuickActionResult({
      action: generatedAction,
      doc,
      layer,
      selection,
    });
  }

  switch (actionId) {
    case 'selectLayerBounds':
      return layer ? buildSelectionResult(selectLayerBounds(doc, layer)) : null;
    case 'selectLayerOpaquePixels':
      return layer ? buildSelectionResult(selectLayerOpaquePixels(doc, layer)) : null;
    case 'growSelection':
      return selection ? buildSelectionResult(growSelection(selection)) : null;
    case 'shrinkSelection':
      return selection ? buildSelectionResult(shrinkSelection(selection)) : null;
    case 'featherSelection':
      return selection ? buildSelectionResult(featherSelection(selection)) : null;
    case 'borderSelection':
      return selection ? buildSelectionResult(borderSelection(selection)) : null;
    case 'smoothSelection':
      return selection ? buildSelectionResult(smoothSelection(selection)) : null;
    case 'nudgeSelectionLeft':
      return selection ? buildSelectionResult(nudgeSelection(selection, -1, 0)) : null;
    case 'nudgeSelectionRight':
      return selection ? buildSelectionResult(nudgeSelection(selection, 1, 0)) : null;
    case 'nudgeSelectionUp':
      return selection ? buildSelectionResult(nudgeSelection(selection, 0, -1)) : null;
    case 'nudgeSelectionDown':
      return selection ? buildSelectionResult(nudgeSelection(selection, 0, 1)) : null;
    case 'clearOutsideSelection': {
      if (!canEditImageLayerPixels(layer) || !selection) return null;
      const operation = clearOutsideSelection(doc, layer, selection);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'layerViaCopy': {
      if (!layer || !selection) return null;
      const newLayer = createLayerViaCopy(doc, layer, selection, createLayerId());
      if (!newLayer) return null;
      const after = insertLayerAfter(doc.layers, layer.id, newLayer);
      return buildLayerOpResult(doc, after, newLayer.id);
    }
    case 'layerViaCut': {
      if (!canEditImageLayerPixels(layer) || !selection) return null;
      const result = createLayerViaCut(doc, layer, selection, createLayerId());
      if (!result) return null;
      const updatedLayer = {
        ...layer,
        bitmap: result.paintOp.after,
        bitmapVersion: layer.bitmapVersion + 1,
      };
      const after = insertLayerAfter(
        replaceLayer(doc.layers, layer.id, updatedLayer),
        layer.id,
        result.newLayer,
      );
      return buildLayerOpResult(doc, after, result.newLayer.id);
    }
    case 'cropLayerToSelection': {
      if (!canEditImageLayerPixels(layer) || !selection) return null;
      const nextLayer = cropLayerToSelection(doc, layer, selection);
      return nextLayer ? buildLayerOpResult(doc, replaceLayer(doc.layers, layer.id, nextLayer), layer.id) : null;
    }
    case 'trimTransparentLayer':
      return applyLayerReplacement(doc, layer, trimTransparentLayer);
    case 'flipLayerHorizontal':
      return applyLayerReplacement(doc, layer, flipLayerHorizontal);
    case 'flipLayerVertical':
      return applyLayerReplacement(doc, layer, flipLayerVertical);
    case 'rotateLayer90Clockwise':
      return applyLayerReplacement(doc, layer, rotateLayer90Clockwise);
    case 'rotateLayer90CounterClockwise':
      return applyLayerReplacement(doc, layer, rotateLayer90CounterClockwise);
    case 'centerLayer':
      return layer ? buildTransformResult(doc, layer, centerLayer(doc, layer)) : null;
    case 'fitLayerToCanvas':
      return applyLayerReplacement(doc, layer, (current) => fitLayerToCanvas(doc, current));
    case 'resetLayerPosition':
      return layer ? buildTransformResult(doc, layer, resetLayerPosition(layer)) : null;
    case 'trimCanvasToVisible': {
      const next = trimCanvasToVisible(doc);
      if (!next) return null;
      return {
        kind: 'docResize',
        operation: {
          kind: 'docResize',
          docId: doc.id,
          before: { width: doc.width, height: doc.height, layers: doc.layers },
          after: next,
        },
      };
    }
    case 'selectCanvas':
      return buildSelectionResult(selectCanvas(doc));
    case 'selectLayerTransparentPixels':
      return layer ? buildSelectionResult(selectLayerTransparentPixels(doc, layer)) : null;
    case 'selectSelectionBoundingBox':
      return selection ? buildSelectionResult(selectSelectionBoundingBox(selection)) : null;
    case 'growSelectionLarge':
      return selection ? buildSelectionResult(growSelection(selection, 4)) : null;
    case 'shrinkSelectionLarge':
      return selection ? buildSelectionResult(shrinkSelection(selection, 4)) : null;
    case 'featherSelectionLarge':
      return selection ? buildSelectionResult(featherSelection(selection, 4)) : null;
    case 'borderSelectionLarge':
      return selection ? buildSelectionResult(borderSelection(selection, 4)) : null;
    case 'clearSelectedPixels': {
      if (!canEditImageLayerPixels(layer) || !selection) return null;
      const operation = clearSelectedPixels(doc, layer, selection);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'localContentAwareFillPatch': {
      if (!canEditImageLayerPixels(layer)) return null;
      const targetSelection = contentAware?.targetKind === 'transparent-pixels' ? null : selection;
      if (contentAware?.outputTarget === 'new-layer') {
        const newLayer = createLocalContentAwareFillLayer(doc, layer, targetSelection, createLayerId(), contentAware);
        return newLayer ? buildLayerOpResult(doc, insertLayerAfter(doc.layers, layer.id, newLayer), newLayer.id) : null;
      }
      const operation = localContentAwareFillPatch(doc, layer, targetSelection, contentAware);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'duplicateLayer': {
      if (!layer) return null;
      const newLayerId = createLayerId();
      return buildLayerOpResult(doc, duplicateLayerQuickAction(doc, layer, newLayerId), newLayerId);
    }
    case 'moveLayerToFront':
      return layer ? buildLayerOpResult(doc, moveLayerToFront(doc, layer), layer.id) : null;
    case 'moveLayerToBack':
      return layer ? buildLayerOpResult(doc, moveLayerToBack(doc, layer), layer.id) : null;
    case 'nudgeLayerLeft':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, -1, 0)) : null;
    case 'nudgeLayerRight':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 1, 0)) : null;
    case 'nudgeLayerUp':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 0, -1)) : null;
    case 'nudgeLayerDown':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 0, 1)) : null;
    case 'nudgeLayerLeftLarge':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, -10, 0)) : null;
    case 'nudgeLayerRightLarge':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 10, 0)) : null;
    case 'nudgeLayerUpLarge':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 0, -10)) : null;
    case 'nudgeLayerDownLarge':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, 0, 10)) : null;
    case 'alignLayerLeft':
      return layer ? buildTransformResult(doc, layer, alignLayerLeft(layer)) : null;
    case 'alignLayerRight':
      return layer ? buildTransformResult(doc, layer, alignLayerRight(doc, layer)) : null;
    case 'alignLayerTop':
      return layer ? buildTransformResult(doc, layer, alignLayerTop(layer)) : null;
    case 'alignLayerBottom':
      return layer ? buildTransformResult(doc, layer, alignLayerBottom(doc, layer)) : null;
    case 'centerLayerHorizontal':
      return layer ? buildTransformResult(doc, layer, centerLayerHorizontal(doc, layer)) : null;
    case 'centerLayerVertical':
      return layer ? buildTransformResult(doc, layer, centerLayerVertical(doc, layer)) : null;
    case 'fitLayerWidthToCanvas':
      return applyLayerReplacement(doc, layer, (current) => fitLayerWidthToCanvas(doc, current));
    case 'fitLayerHeightToCanvas':
      return applyLayerReplacement(doc, layer, (current) => fitLayerHeightToCanvas(doc, current));
    case 'invertLayerColors': {
      if (!canEditImageLayerPixels(layer)) return null;
      const operation = invertLayerColors(doc, layer);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'desaturateLayer': {
      if (!canEditImageLayerPixels(layer)) return null;
      const operation = desaturateLayer(doc, layer);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'resetLayerOpacity':
      return layer ? buildLayerOpResult(doc, replaceLayer(doc.layers, layer.id, { ...layer, opacity: 1 }), layer.id) : null;
    case 'selectTopHalf':
      return buildSelectionResult(selectTopHalf(doc));
    case 'selectBottomHalf':
      return buildSelectionResult(selectBottomHalf(doc));
    case 'selectLeftHalf':
      return buildSelectionResult(selectLeftHalf(doc));
    case 'selectRightHalf':
      return buildSelectionResult(selectRightHalf(doc));
    case 'selectCenterSquare':
      return buildSelectionResult(selectCenterSquare(doc));
    case 'selectHorizontalCenterBand':
      return buildSelectionResult(selectHorizontalCenterBand(doc));
    case 'selectVerticalCenterBand':
      return buildSelectionResult(selectVerticalCenterBand(doc));
    case 'setLayerOpacity25':
      return setLayerOpacityResult(doc, layer, 0.25);
    case 'setLayerOpacity50':
      return setLayerOpacityResult(doc, layer, 0.5);
    case 'setLayerOpacity75':
      return setLayerOpacityResult(doc, layer, 0.75);
    case 'setLayerBlendNormal':
      return setLayerBlendModeResult(doc, layer, 'normal');
    case 'setLayerBlendMultiply':
      return setLayerBlendModeResult(doc, layer, 'multiply');
    case 'setLayerBlendScreen':
      return setLayerBlendModeResult(doc, layer, 'screen');
    case 'setLayerBlendOverlay':
      return setLayerBlendModeResult(doc, layer, 'overlay');
    case 'rotateLayer180':
      return applyLayerReplacement(doc, layer, rotateLayer180);
    case 'raiseLayerOneStep':
      return layer ? buildLayerOpResult(doc, raiseLayerOneStep(doc, layer), layer.id) : null;
    case 'lowerLayerOneStep':
      return layer ? buildLayerOpResult(doc, lowerLayerOneStep(doc, layer), layer.id) : null;
    case 'fitLayerInsideCanvas':
      return applyLayerReplacement(doc, layer, (current) => fitLayerInsideCanvas(doc, current));
    case 'fillLayerToCanvas':
      return applyLayerReplacement(doc, layer, (current) => fillLayerToCanvas(doc, current));
    case 'rasterizeLayerToCanvas':
      return applyLayerReplacement(doc, layer, (current) => rasterizeLayerToCanvas(doc, current));
  }
  return null;
}


function createGeneratedQuickActionResult({
  action,
  doc,
  layer,
  selection,
}: {
  action: GeneratedQuickActionDefinition;
  doc: ImageDocument;
  layer: ImageLayer | null | undefined;
  selection?: SelectionMask | null;
}): PhotoshopQuickActionResult | null {
  switch (action.kind) {
    case 'selectionMorphology':
      if (!selection) return null;
      if (action.operation === 'grow') return buildSelectionResult(growSelection(selection, action.radius));
      if (action.operation === 'shrink') return buildSelectionResult(shrinkSelection(selection, action.radius));
      if (action.operation === 'feather') return buildSelectionResult(featherSelection(selection, action.radius));
      return buildSelectionResult(borderSelection(selection, action.radius));
    case 'selectionGrid':
      return buildSelectionResult(selectGridCell(doc, action.columns, action.rows, action.cell));
    case 'selectionEdge':
      return buildSelectionResult(selectEdgeStripPercent(doc, action.edge, action.percent));
    case 'selectionInset':
      return buildSelectionResult(selectInsetPercent(doc, action.percent));
    case 'selectionBorderRing':
      return buildSelectionResult(selectBorderRingPercent(doc, action.percent));
    case 'layerOpacity':
      return setLayerOpacityResult(doc, layer, action.opacity);
    case 'layerBlend':
      return setLayerBlendModeResult(doc, layer, action.blendMode);
    case 'nudge':
      return layer ? buildTransformResult(doc, layer, nudgeLayer(layer, action.dx, action.dy)) : null;
    case 'layerScale':
      return applyLayerReplacement(doc, layer, (current) => scaleLayerByPercent(doc, current, action.percent));
    case 'brightness': {
      if (!canEditImageLayerPixels(layer)) return null;
      const operation = adjustLayerBrightness(doc, layer, action.delta);
      return operation ? { kind: 'paint', operation } : null;
    }
    case 'pixelAlpha': {
      if (!canEditImageLayerPixels(layer)) return null;
      const operation = setLayerPixelAlphaPercent(doc, layer, action.percent);
      return operation ? { kind: 'paint', operation } : null;
    }
  }
}
