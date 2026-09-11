import type { BlendMode, EditorOperation } from '../../../types/imageEditor';
import type { SelectionMask } from '../SelectionMask';

export interface PhotoshopQuickAction {
  id: string;
  label: string;
  group: 'Selection' | 'Pixels' | 'Layer' | 'Transform' | 'Canvas';
}

export type PhotoshopQuickActionCategory = PhotoshopQuickAction['group'];

export type PhotoshopQuickActionCapabilityInput =
  | 'document'
  | 'activeLayer'
  | 'editablePixels'
  | 'movableLayer'
  | 'selection';

export type PhotoshopQuickActionCapabilityOutput =
  | 'selection'
  | 'paint'
  | 'layer'
  | 'transform'
  | 'document';

export type PhotoshopQuickActionImplementation =
  | 'local-deterministic'
  | 'local-approximation';

export interface PhotoshopQuickActionCapabilityDescriptor {
  id: string;
  label: string;
  category: PhotoshopQuickActionCategory;
  input: readonly PhotoshopQuickActionCapabilityInput[];
  output: PhotoshopQuickActionCapabilityOutput;
  undoable: boolean;
  mutatesDocument: boolean;
  implementation: PhotoshopQuickActionImplementation;
  warning: string | null;
}

export interface PhotoshopQuickActionWarningSummary {
  id: string;
  label: string;
  warning: string;
}

export interface PhotoshopQuickActionCatalogSummary {
  total: number;
  byCategory: Record<PhotoshopQuickActionCategory, number>;
  byInput: Record<PhotoshopQuickActionCapabilityInput, number>;
  byOutput: Record<PhotoshopQuickActionCapabilityOutput, number>;
  undoable: {
    undoable: number;
    notUndoable: number;
  };
  mutatesDocument: {
    mutating: number;
    nonMutating: number;
  };
  warnings: readonly PhotoshopQuickActionWarningSummary[];
}

export type GeneratedQuickActionDefinition =
  | (PhotoshopQuickAction & { kind: 'selectionMorphology'; operation: 'grow' | 'shrink' | 'feather' | 'border'; radius: number })
  | (PhotoshopQuickAction & { kind: 'selectionGrid'; columns: number; rows: number; cell: number })
  | (PhotoshopQuickAction & { kind: 'selectionEdge'; edge: 'top' | 'bottom' | 'left' | 'right'; percent: number })
  | (PhotoshopQuickAction & { kind: 'selectionInset'; percent: number })
  | (PhotoshopQuickAction & { kind: 'selectionBorderRing'; percent: number })
  | (PhotoshopQuickAction & { kind: 'layerOpacity'; opacity: number })
  | (PhotoshopQuickAction & { kind: 'layerBlend'; blendMode: BlendMode })
  | (PhotoshopQuickAction & { kind: 'nudge'; dx: number; dy: number })
  | (PhotoshopQuickAction & { kind: 'layerScale'; percent: number })
  | (PhotoshopQuickAction & { kind: 'brightness'; delta: number })
  | (PhotoshopQuickAction & { kind: 'pixelAlpha'; percent: number });

export type PhotoshopQuickActionId = string;

export type PhotoshopQuickActionResult =
  | {
      kind: 'selection';
      selection: SelectionMask;
      hasSelection: boolean;
    }
  | {
      kind: 'paint';
      operation: Extract<EditorOperation, { kind: 'paint' }>;
    }
  | {
      kind: 'transform';
      operation: Extract<EditorOperation, { kind: 'transform' }>;
    }
  | {
      kind: 'layerOp';
      operation: Extract<EditorOperation, { kind: 'layerOp' }>;
      activeLayerId: string | null;
    }
  | {
      kind: 'docResize';
      operation: Extract<EditorOperation, { kind: 'docResize' }>;
    };
