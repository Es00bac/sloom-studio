import type {
  EditorOperation,
  ImageDocument,
  ImageQuickActionMacro,
  ImageQuickActionMacroStep,
} from '../../types/imageEditor';
import { inspectImageDocumentSnapshotIntegrity } from './ImageSnapshots';
import { PHOTOSHOP_QUICK_ACTIONS } from './PhotoshopQuickActions';

export type ImageHistoryStateStatus = 'current' | 'past' | 'future';
export type ImageHistoryWorkflowOperationKind = EditorOperation['kind'] | 'origin';

export interface ImageHistoryStateEntry {
  id: string;
  label: string;
  targetUndoCount: number;
  status: ImageHistoryStateStatus;
  operationKind?: ImageHistoryWorkflowOperationKind;
}

export type ImageHistoryActionWorkflowLimitationCode =
  | 'arbitrary-command-recording-unsupported'
  | 'parameterized-action-steps-unsupported';

export interface ImageHistoryActionWorkflowLimitation {
  code: ImageHistoryActionWorkflowLimitationCode;
  severity: 'info';
  message: string;
}

export interface ImageHistoryFixedCommandWarning extends ImageHistoryActionWorkflowLimitation {
  commandScope: 'recording' | 'playback';
}

export interface ImageHistoryActionWorkflowStepDescriptor {
  id: string;
  actionId: string;
  label: string;
  supported: boolean;
}

export interface ImageHistoryActionWorkflowMacroDescriptor {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  stepCount: number;
  allStepsSupported: boolean;
  unsupportedActionIds: string[];
  steps: ImageHistoryActionWorkflowStepDescriptor[];
  deterministicPlayback: true;
  openDocumentBatchSupported: true;
  fileFolderBatchSupported: false;
  arbitraryCommandRecordingSupported: false;
  playbackSignature: string;
}

export interface ImageHistoryActionWorkflowSnapshotDescriptor {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  width: number;
  height: number;
  layerCount: number;
  activeLayerId: string | null;
  hasSelection: boolean;
  selectionVersion: number;
  canRestore: boolean;
  canDelete: boolean;
  canRename: boolean;
  isNewest: boolean;
  kind: 'named-snapshot';
  identity: string;
}

export interface ImageHistoryActionWorkflowDescriptor {
  descriptorId: 'image-history-action-workflow:v1';
  document: {
    id: string;
    title: string;
    width: number;
    height: number;
    layerCount: number;
  };
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undoCount: number;
    redoCount: number;
    currentUndoCount: number;
    currentStateLabel: string;
    entries: ImageHistoryStateEntry[];
  };
  snapshots: {
    count: number;
    maxRetained: number;
    canCreate: boolean;
    items: ImageHistoryActionWorkflowSnapshotDescriptor[];
  };
  recording: {
    active: boolean;
    startedAt: number | null;
    stepCount: number;
    canSave: boolean;
    unsupportedActionIds: string[];
    steps: ImageHistoryActionWorkflowStepDescriptor[];
  };
  savedActions: {
    count: number;
    canPlay: boolean;
    canBatchPlay: boolean;
    macros: ImageHistoryActionWorkflowMacroDescriptor[];
  };
  snapshotSummary: {
    identity: string;
    restoreTargets: string[];
    deleteTargets: string[];
    renameTargets: string[];
    newestSnapshotId: string | null;
  };
  actionSetSummary: {
    identity: string;
    playableActionIds: string[];
    unavailableActionIds: string[];
    unsupportedCommandIds: string[];
  };
  automationBoundary: {
    separateFromMainFlow: true;
    requiredWorkspace: 'image-automation';
    reason: string;
  };
  limitations: ImageHistoryActionWorkflowLimitation[];
  fixedCommandWarnings: ImageHistoryFixedCommandWarning[];
  previewSignature: string;
}

export interface BuildImageHistoryActionWorkflowDescriptorOptions {
  doc: ImageDocument;
  undoStack: readonly EditorOperation[];
  redoStack: readonly EditorOperation[];
  activeRecording?: {
    startedAt: number;
    steps: readonly ImageQuickActionMacroStep[];
  } | null;
  quickActionMacros?: readonly ImageQuickActionMacro[];
}

const IMAGE_HISTORY_SNAPSHOT_MAX_RETAINED = 12;
const QUICK_ACTIONS_BY_ID = new Map(PHOTOSHOP_QUICK_ACTIONS.map((action) => [action.id, action] as const));

export function getEditorOperationLabel(operation: EditorOperation): string {
  const customLabel = (operation as EditorOperation & { label?: string }).label;
  if (customLabel) return customLabel;

  switch (operation.kind) {
    case 'paint':
      return operation.paintTarget === 'mask' ? 'Paint Layer Mask' : 'Paint Pixels';
    case 'selection':
      return 'Selection Change';
    case 'transform':
      return `Transform ${operation.layerId}`;
    case 'multiTransform':
      return `Transform ${Object.keys(operation.after).length} Layers`;
    case 'layerOp': {
      if (operation.after.length > operation.before.length) {
        const added = operation.after.find((layer) => !operation.before.some((before) => before.id === layer.id));
        return added ? `Add Layer ${added.name}` : 'Add Layer';
      }
      if (operation.after.length < operation.before.length) {
        const removed = operation.before.find((layer) => !operation.after.some((after) => after.id === layer.id));
        return removed ? `Delete Layer ${removed.name}` : 'Delete Layer';
      }
      const reordered = operation.before.some((layer, index) => operation.after[index]?.id !== layer.id);
      if (reordered) return 'Reorder Layers';
      const changed = operation.after.find((layer, index) => JSON.stringify(layer) !== JSON.stringify(operation.before[index]));
      return changed ? `Edit Layer ${changed.name}` : 'Layer Change';
    }
    case 'docResize':
      return 'Resize Document';
    case 'documentState': {
      const beforeSnapshots = operation.before.snapshots?.length ?? 0;
      const afterSnapshots = operation.after.snapshots?.length ?? 0;
      if (afterSnapshots > beforeSnapshots) return 'New Snapshot';
      if (afterSnapshots < beforeSnapshots) return 'Delete Snapshot';
      const beforePaths = operation.before.savedWorkPaths?.length ?? 0;
      const afterPaths = operation.after.savedWorkPaths?.length ?? 0;
      if (afterPaths > beforePaths) return 'Save Path';
      if (afterPaths < beforePaths) return 'Delete Path';
      if (afterPaths === beforePaths && afterPaths > 0) {
        const renamed = operation.after.savedWorkPaths?.find((path, index) => (
          path.name !== operation.before.savedWorkPaths?.[index]?.name
        ));
        if (renamed) return 'Rename Path';
      }
      return 'Document State';
    }
    case 'convertDepth':
      return operation.after.bitDepth === 8
        ? 'Convert to 8 Bits/Channel'
        : `Convert to ${operation.after.bitDepth} Bits/Channel`;
    case 'highBitPaint':
      return 'Paint Pixels at Document Depth';
  }
}

function getQuickActionStepDescriptor(
  step: ImageQuickActionMacroStep,
  index: number,
  idPrefix: string,
): ImageHistoryActionWorkflowStepDescriptor {
  const action = QUICK_ACTIONS_BY_ID.get(step.actionId);
  return {
    id: `${idPrefix}-${index + 1}`,
    actionId: step.actionId,
    label: action ? `${action.group}: ${action.label}` : step.actionId,
    supported: Boolean(action),
  };
}

function uniqueActionIds(actionIds: readonly string[]): string[] {
  return [...new Set(actionIds)].sort((left, right) => left.localeCompare(right));
}

function getUnsupportedActionIds(steps: readonly ImageHistoryActionWorkflowStepDescriptor[]): string[] {
  return uniqueActionIds(steps.filter((step) => !step.supported).map((step) => step.actionId));
}

export function buildImageHistoryStateEntries(
  undoStack: readonly EditorOperation[],
  redoStack: readonly EditorOperation[],
): ImageHistoryStateEntry[] {
  const entries: ImageHistoryStateEntry[] = [];

  if (undoStack.length === 0) {
    entries.push({
      id: 'history-origin-current',
      label: 'Open Document',
      targetUndoCount: 0,
      status: 'current',
      operationKind: 'origin',
    });
  } else {
    for (let index = undoStack.length - 1; index >= 0; index -= 1) {
      entries.push({
        id: `history-undo-${index}`,
        label: getEditorOperationLabel(undoStack[index]),
        targetUndoCount: index + 1,
        status: index === undoStack.length - 1 ? 'current' : 'past',
        operationKind: undoStack[index].kind,
      });
    }
    entries.push({
      id: 'history-origin-past',
      label: 'Open Document',
      targetUndoCount: 0,
      status: 'past',
      operationKind: 'origin',
    });
  }

  const currentUndoCount = undoStack.length;
  for (let index = redoStack.length - 1; index >= 0; index -= 1) {
    entries.push({
      id: `history-redo-${index}`,
      label: getEditorOperationLabel(redoStack[index]),
      targetUndoCount: currentUndoCount + (redoStack.length - index),
      status: 'future',
      operationKind: redoStack[index].kind,
    });
  }

  return entries;
}

export function buildImageHistoryActionWorkflowDescriptor({
  doc,
  undoStack,
  redoStack,
  activeRecording = null,
  quickActionMacros = [],
}: BuildImageHistoryActionWorkflowDescriptorOptions): ImageHistoryActionWorkflowDescriptor {
  const historyEntries = buildImageHistoryStateEntries(undoStack, redoStack);
  const currentStateLabel = historyEntries.find((entry) => entry.status === 'current')?.label ?? 'Open Document';
  const recordingSteps = (activeRecording?.steps ?? []).map((step, index) => (
    getQuickActionStepDescriptor(step, index, 'recording-step')
  ));
  const savedMacros = [...quickActionMacros]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((macro) => {
      const steps = macro.steps.map((step, index) => (
        getQuickActionStepDescriptor(step, index, `${macro.id}-step`)
      ));
      const unsupportedActionIds = getUnsupportedActionIds(steps);
      return {
        id: macro.id,
        name: macro.name,
        createdAt: macro.createdAt,
        updatedAt: macro.updatedAt,
        stepCount: steps.length,
        allStepsSupported: unsupportedActionIds.length === 0,
        unsupportedActionIds,
        steps,
        deterministicPlayback: true as const,
        openDocumentBatchSupported: true as const,
        fileFolderBatchSupported: false as const,
        arbitraryCommandRecordingSupported: false as const,
        playbackSignature: `image-history-action-macro:v2:${JSON.stringify({
          id: macro.id,
          stepIds: macro.steps.map((step) => step.actionId),
          unsupportedActionIds,
          allStepsSupported: unsupportedActionIds.length === 0,
        })}`,
      };
    });
  const limitations: ImageHistoryActionWorkflowLimitation[] = [
    {
      code: 'arbitrary-command-recording-unsupported',
      severity: 'info',
      message: 'History Actions record and replay Sloom Studio quick action ids only; arbitrary Photoshop menu commands are not captured.',
    },
    {
      code: 'parameterized-action-steps-unsupported',
      severity: 'info',
      message: 'Recorded action steps do not store per-command parameters yet, so parameterized action playback remains unsupported.',
    },
  ];
  const fixedCommandWarnings: ImageHistoryFixedCommandWarning[] = [
    {
      ...limitations[0],
      commandScope: 'recording',
    },
    {
      ...limitations[1],
      commandScope: 'playback',
    },
  ];
  const newestSnapshotId = (doc.snapshots ?? []).reduce<string | null>((newestId, snapshot) => {
    if (!newestId) return snapshot.id;
    const newestSnapshot = doc.snapshots?.find((candidate) => candidate.id === newestId);
    return !newestSnapshot || snapshot.createdAt > newestSnapshot.createdAt ? snapshot.id : newestId;
  }, null);
  const snapshotItems = (doc.snapshots ?? []).map((snapshot) => {
    const integrity = inspectImageDocumentSnapshotIntegrity(snapshot);
    return {
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      ...(snapshot.updatedAt !== undefined ? { updatedAt: snapshot.updatedAt } : {}),
      width: snapshot.width,
      height: snapshot.height,
      layerCount: snapshot.layers.length,
      activeLayerId: snapshot.activeLayerId,
      hasSelection: snapshot.hasSelection,
      selectionVersion: snapshot.selectionVersion,
      canRestore: integrity.complete,
      canDelete: true,
      canRename: true,
      isNewest: snapshot.id === newestSnapshotId,
      kind: 'named-snapshot' as const,
      identity: `${snapshot.id}:${snapshot.name}:${snapshot.width}x${snapshot.height}:${snapshot.layers.length}-layers:selection-${snapshot.selectionVersion}-${integrity.selectionComplete ? 'complete' : 'unavailable'}:pixels-${integrity.complete ? 'proven' : 'unavailable'}`,
    };
  });
  const unsupportedCommandIds = uniqueActionIds([
    ...getUnsupportedActionIds(recordingSteps),
    ...savedMacros.flatMap((macro) => macro.unsupportedActionIds),
  ]);

  const descriptor: ImageHistoryActionWorkflowDescriptor = {
    descriptorId: 'image-history-action-workflow:v1',
    document: {
      id: doc.id,
      title: doc.title,
      width: doc.width,
      height: doc.height,
      layerCount: doc.layers.length,
    },
    history: {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoCount: undoStack.length,
      redoCount: redoStack.length,
      currentUndoCount: undoStack.length,
      currentStateLabel,
      entries: historyEntries,
    },
    snapshots: {
      count: doc.snapshots?.length ?? 0,
      maxRetained: IMAGE_HISTORY_SNAPSHOT_MAX_RETAINED,
      canCreate: true,
      items: snapshotItems,
    },
    recording: {
      active: Boolean(activeRecording),
      startedAt: activeRecording?.startedAt ?? null,
      stepCount: recordingSteps.length,
      canSave: recordingSteps.length > 0,
      unsupportedActionIds: getUnsupportedActionIds(recordingSteps),
      steps: recordingSteps,
    },
    savedActions: {
      count: quickActionMacros.length,
      canPlay: savedMacros.length > 0,
      canBatchPlay: savedMacros.length > 0,
      macros: savedMacros,
    },
    snapshotSummary: {
      identity: `${doc.id}:${doc.width}x${doc.height}:${doc.layers.length}-layers:${snapshotItems.length}-snapshots`,
      restoreTargets: snapshotItems.filter((snapshot) => snapshot.canRestore).map((snapshot) => snapshot.id),
      deleteTargets: snapshotItems.filter((snapshot) => snapshot.canDelete).map((snapshot) => snapshot.id),
      renameTargets: snapshotItems.filter((snapshot) => snapshot.canRename).map((snapshot) => snapshot.id),
      newestSnapshotId,
    },
    actionSetSummary: {
      identity: `${savedMacros.length}-actions:${savedMacros.reduce((total, macro) => total + macro.stepCount, 0)}-steps:${savedMacros.filter((macro) => !macro.allStepsSupported).length}-unsupported`,
      playableActionIds: savedMacros.filter((macro) => macro.allStepsSupported).map((macro) => macro.id),
      unavailableActionIds: savedMacros.filter((macro) => !macro.allStepsSupported).map((macro) => macro.id),
      unsupportedCommandIds,
    },
    automationBoundary: {
      separateFromMainFlow: true,
      requiredWorkspace: 'image-automation',
      reason: 'History Actions stay in Image Automation planning/playback surfaces and are not executable from the main Flow graph.',
    },
    limitations,
    fixedCommandWarnings,
    previewSignature: '',
  };

  descriptor.previewSignature = `image-history-action-workflow:v1:${JSON.stringify({
    document: {
      id: descriptor.document.id,
      width: descriptor.document.width,
      height: descriptor.document.height,
      layerCount: descriptor.document.layerCount,
      snapshotCount: descriptor.snapshots.count,
    },
    history: {
      undoCount: descriptor.history.undoCount,
      redoCount: descriptor.history.redoCount,
      currentStateLabel: descriptor.history.currentStateLabel,
      entries: descriptor.history.entries.map((entry) => ({
        id: entry.id,
        status: entry.status,
        targetUndoCount: entry.targetUndoCount,
        label: entry.label,
        operationKind: entry.operationKind,
      })),
    },
    snapshots: descriptor.snapshots.items.map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      ...(snapshot.updatedAt !== undefined ? { updatedAt: snapshot.updatedAt } : {}),
      width: snapshot.width,
      height: snapshot.height,
      layerCount: snapshot.layerCount,
      canRename: snapshot.canRename,
      isNewest: snapshot.isNewest,
      identity: snapshot.identity,
    })),
    recording: {
      active: descriptor.recording.active,
      stepCount: descriptor.recording.stepCount,
      unsupportedActionIds: descriptor.recording.unsupportedActionIds,
    },
    savedActions: descriptor.savedActions.macros.map((macro) => ({
      id: macro.id,
      name: macro.name,
      stepCount: macro.stepCount,
      unsupportedActionIds: macro.unsupportedActionIds,
      playbackSignature: macro.playbackSignature,
    })),
    automationBoundary: descriptor.automationBoundary,
    limitations: descriptor.limitations.map((limitation) => limitation.code),
  })}`;

  return descriptor;
}
