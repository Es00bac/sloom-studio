import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer } from '../../types/imageEditor';
import {
  buildImageQuickActionMacroReadiness,
  buildImageQuickActionMacroPlaybackDiagnostics,
  describeImageQuickActionReadiness,
  exportImageQuickActionMacroSet,
  importImageQuickActionMacroSet,
  normalizeImageQuickActionMacroDescriptor,
  playImageQuickActionMacroAcrossOpenDocuments,
  validateImageQuickActionMacroSet,
} from './ImageQuickActionMacros';

function makeLayer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: patch.id ?? 'layer-1',
    name: patch.name ?? 'Layer 1',
    type: patch.type ?? 'image',
    visible: patch.visible ?? true,
    locked: patch.locked ?? false,
    opacity: patch.opacity ?? 1,
    blendMode: patch.blendMode ?? 'normal',
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    bitmap: patch.bitmap ?? null,
    bitmapVersion: patch.bitmapVersion ?? 0,
    mask: patch.mask ?? null,
    ...patch,
  };
}

describe('ImageQuickActionMacros', () => {
  beforeEach(() => {
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      quickActionMacros: [],
      activeQuickActionRecording: null,
    });
  });

  it('plays a saved action set across all open image documents and restores the original active document', () => {
    const docA = {
      ...createEmptyImageDocument({ id: 'doc-a', title: 'Doc A', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-a', x: 2, y: 0 })],
      activeLayerId: 'layer-a',
    };
    const docB = {
      ...createEmptyImageDocument({ id: 'doc-b', title: 'Doc B', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-b', x: 7, y: 0 })],
      activeLayerId: 'layer-b',
    };

    useImageEditorStore.getState().openDocument(docA);
    useImageEditorStore.getState().openDocument(docB);
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-1',
        name: 'Batch Nudge',
        createdAt: 10,
        updatedAt: 10,
        steps: [{ actionId: 'nudgeLayerRightLarge' }],
      }],
    });

    const result = playImageQuickActionMacroAcrossOpenDocuments('macro-1');

    expect(result).toEqual({
      macroId: 'macro-1',
      requestedCount: 2,
      successCount: 2,
      failedDocIds: [],
    });
    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'doc-a')?.layers[0]?.x).toBe(12);
    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'doc-b')?.layers[0]?.x).toBe(17);
    expect(useImageEditorStore.getState().activeDocId).toBe('doc-b');
  });

  it('normalizes macro descriptors with stable ids, names, steps, and tags', () => {
    expect(normalizeImageQuickActionMacroDescriptor({
      id: '  Macro/One  ',
      name: '  Cleanup pass  ',
      tags: [' cleanup ', 'Batch', 'cleanup', '', ' batch '],
      steps: [
        { id: '  Step One  ', actionId: '  nudgeLayerRightLarge  ', params: undefined },
        { actionId: 'nudgeLayerDownLarge' },
      ],
    }, 1)).toEqual({
      id: 'Macro-One',
      name: 'Cleanup pass',
      steps: [
        { id: 'Step-One', actionId: 'nudgeLayerRightLarge' },
        { id: 'step-2', actionId: 'nudgeLayerDownLarge' },
      ],
      tags: ['cleanup', 'batch'],
    });

    expect(normalizeImageQuickActionMacroDescriptor({
      name: '',
      steps: [{ actionId: 'nudgeLayerRightLarge' }],
    }, 3)).toMatchObject({
      id: 'macro-3',
      name: 'Macro 3',
      tags: [],
    });
  });

  it('validates missing action ids, duplicate step ids, and unsupported parameter payloads deterministically', () => {
    const validation = validateImageQuickActionMacroSet([
      {
        id: 'cleanup',
        name: 'Cleanup',
        steps: [
          { id: 'repeat', actionId: 'nudgeLayerRightLarge' },
          { id: 'repeat', actionId: 'missingAction' },
          { id: 'with-params', actionId: 'nudgeLayerDownLarge', params: { dx: 10 } },
        ],
        tags: ['batch'],
      },
    ], {
      supportedActionIds: ['nudgeLayerRightLarge', 'nudgeLayerDownLarge'],
    });

    expect(validation.valid).toBe(false);
    expect(validation.missingActionIds).toEqual(['missingAction']);
    expect(validation.duplicateStepIds).toEqual(['cleanup:repeat']);
    expect(validation.unsupportedParameterSteps).toEqual(['cleanup:with-params']);
    expect(validation.issues).toEqual([
      {
        code: 'duplicate-step-id',
        macroId: 'cleanup',
        stepId: 'repeat',
        message: 'Macro cleanup has duplicate step id repeat.',
      },
      {
        code: 'missing-action-id',
        macroId: 'cleanup',
        stepId: 'repeat',
        actionId: 'missingAction',
        message: 'Macro cleanup step repeat references unsupported action missingAction.',
      },
      {
        code: 'unsupported-params',
        macroId: 'cleanup',
        stepId: 'with-params',
        actionId: 'nudgeLayerDownLarge',
        message: 'Macro cleanup step with-params has unsupported parameter payloads.',
      },
    ]);
  });

  it('exports and imports normalized macro sets as deterministic JSON', () => {
    const macros = [
      {
        id: 'macro-b',
        name: 'Macro B',
        createdAt: 20,
        updatedAt: 22,
        steps: [{ actionId: 'nudgeLayerDownLarge' }],
      },
      {
        id: 'macro-a',
        name: 'Macro A',
        createdAt: 10,
        updatedAt: 12,
        tags: ['Cleanup'],
        steps: [{ id: 'move', actionId: 'nudgeLayerRightLarge' }],
      },
    ];

    const exported = exportImageQuickActionMacroSet(macros);

    expect(exported).toBe(
      '{"schemaVersion":1,"macros":[{"id":"macro-a","name":"Macro A","steps":[{"id":"move","actionId":"nudgeLayerRightLarge"}],"tags":["cleanup"]},{"id":"macro-b","name":"Macro B","steps":[{"id":"step-1","actionId":"nudgeLayerDownLarge"}],"tags":[]}]}',
    );
    expect(importImageQuickActionMacroSet(exported)).toEqual({
      schemaVersion: 1,
      macros: [
        {
          id: 'macro-a',
          name: 'Macro A',
          steps: [{ id: 'move', actionId: 'nudgeLayerRightLarge' }],
          tags: ['cleanup'],
        },
        {
          id: 'macro-b',
          name: 'Macro B',
          steps: [{ id: 'step-1', actionId: 'nudgeLayerDownLarge' }],
          tags: [],
        },
      ],
    });
    expect(importImageQuickActionMacroSet('bad-json')).toBeNull();
  });

  it('builds deterministic per-document playback diagnostics for unavailable fixed commands', () => {
    const diagnostics = buildImageQuickActionMacroPlaybackDiagnostics({
      macro: {
        id: 'macro-cleanup',
        name: 'Cleanup',
        createdAt: 20,
        updatedAt: 30,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'missingFixedCommand' },
        ],
      },
      documents: [
        {
          ...createEmptyImageDocument({ id: 'doc-b', title: 'B Cover', width: 800, height: 600 }),
          layers: [],
          activeLayerId: null,
        },
        {
          ...createEmptyImageDocument({ id: 'doc-a', title: 'A Cover', width: 400, height: 300 }),
          layers: [makeLayer({ id: 'layer-a' })],
          activeLayerId: 'layer-a',
        },
      ],
      activeDocId: 'doc-a',
      supportedActionIds: ['nudgeLayerRightLarge'],
    });

    expect(diagnostics).toMatchObject({
      descriptorId: 'image-quick-action-playback-diagnostics:v1',
      macro: {
        id: 'macro-cleanup',
        name: 'Cleanup',
        stepCount: 2,
        identity: 'macro-cleanup:Cleanup:2-steps:1-unavailable',
      },
      commandAvailability: {
        supportedActionIds: ['nudgeLayerRightLarge'],
        unavailableActionIds: ['missingFixedCommand'],
        warnings: [
          {
            code: 'unavailable-command',
            severity: 'warning',
            actionId: 'missingFixedCommand',
            message: 'Quick action command missingFixedCommand is not available for playback.',
          },
        ],
      },
      commandRecordingCaveats: {
        arbitraryCommandsSupported: false,
        parameterizedStepsSupported: false,
        fixedQuickActionIdsOnly: true,
        message: 'Playback diagnostics assume fixed Sloom Studio quick action ids only; arbitrary commands and parameter payloads remain descriptor-only caveats.',
      },
      documents: [
        {
          id: 'doc-b',
          title: 'B Cover',
          width: 800,
          height: 600,
          layerCount: 0,
          active: false,
          canAttemptPlayback: false,
          warnings: [
            {
              code: 'no-active-layer',
              severity: 'warning',
              message: 'Document doc-b has no active layer for layer-targeted quick actions.',
            },
            {
              code: 'unavailable-command',
              severity: 'warning',
              actionId: 'missingFixedCommand',
              message: 'Quick action command missingFixedCommand is not available for playback.',
            },
          ],
        },
        {
          id: 'doc-a',
          title: 'A Cover',
          width: 400,
          height: 300,
          layerCount: 1,
          active: true,
          canAttemptPlayback: false,
          warnings: [
            {
              code: 'unavailable-command',
              severity: 'warning',
              actionId: 'missingFixedCommand',
              message: 'Quick action command missingFixedCommand is not available for playback.',
            },
          ],
        },
      ],
      preview: {
        id: 'image-quick-action-preview:macro-cleanup:2-docs:1-unavailable',
        documentCount: 2,
        attemptedDocumentCount: 0,
        unavailableCommandCount: 1,
        signature: 'image-quick-action-playback-diagnostics:v1:{"macro":{"id":"macro-cleanup","stepCount":2,"unavailableActionIds":["missingFixedCommand"]},"documents":[{"id":"doc-b","layerCount":0,"active":false,"canAttemptPlayback":false,"warningCodes":["no-active-layer","unavailable-command"]},{"id":"doc-a","layerCount":1,"active":true,"canAttemptPlayback":false,"warningCodes":["unavailable-command"]}]}',
      },
      batchOpenDocuments: {
        supported: true,
        scope: 'currently-open-image-documents',
        documentCount: 2,
        attemptedDocumentCount: 0,
        blockedDocumentCount: 2,
        previewSignature: 'image-quick-action-playback-diagnostics:v1:{"macro":{"id":"macro-cleanup","stepCount":2,"unavailableActionIds":["missingFixedCommand"]},"documents":[{"id":"doc-b","layerCount":0,"active":false,"canAttemptPlayback":false,"warningCodes":["no-active-layer","unavailable-command"]},{"id":"doc-a","layerCount":1,"active":true,"canAttemptPlayback":false,"warningCodes":["unavailable-command"]}]}',
        deterministicRouteSignature: 'image-quick-action-open-doc-batch:v2:{"macroId":"macro-cleanup","documentIds":["doc-b","doc-a"],"attemptedDocumentIds":[],"blockedDocumentIds":["doc-b","doc-a"],"unavailableActionIds":["missingFixedCommand"]}',
      },
      fileFolderBatch: {
        supported: false,
        unsupportedInputKinds: ['file-list', 'folder'],
        caveats: [
          'File-list batch queues are not wired to quick-action macro playback.',
          'Folder input/output batch processing is not implemented for Image quick actions.',
          'Playback diagnostics only cover documents that are already open in the Image workspace.',
        ],
        warnings: [
          {
            code: 'file-folder-batch-unsupported',
            severity: 'warning',
            message: 'File/folder batch playback is not implemented; macro playback only targets currently open Image documents.',
          },
        ],
        readinessSignature: 'image-quick-action-file-folder-batch:v2:{"macroId":"macro-cleanup","supported":false,"unsupportedInputKinds":["file-list","folder"],"openDocumentScope":"currently-open-image-documents"}',
      },
      automationBoundary: {
        separateFromMainFlow: true,
        requiredWorkspace: 'image-automation',
        mainFlowCallable: false,
        reason: 'Quick action macro playback stays in Image Automation surfaces and does not become a main Flow node execution path.',
      },
      nativeExecution: {
        supported: false,
        reason: 'Quick action macros are deterministic browser/store playback descriptors only; unattended native filesystem execution is not wired.',
        requiredWorkspace: 'image-automation',
      },
      importExportUi: {
        manifestSchemaVersion: 1,
        canSerializeManifest: true,
        canParseManifest: true,
        hasDedicatedImportUi: false,
        hasDedicatedExportUi: false,
        gaps: [
          'No dedicated Image Automation import button is wired to macro manifests.',
          'No dedicated Image Automation export button is wired to macro manifests.',
        ],
      },
      workspaceHandoff: {
        workspaceId: 'image-automation',
        ready: false,
        handoffKind: 'macro-playback-preview',
        requiredPayloads: ['macro-manifest', 'open-document-targets', 'command-availability'],
        blockers: [
          'Native unattended execution is not implemented.',
          'Macro import/export UI is descriptor-only.',
          'Document doc-b has no active layer for layer-targeted quick actions.',
          'One or more macro commands are unavailable.',
        ],
      },
    });
  });

  it('describes automation handoff gaps without enabling unattended native execution', () => {
    const diagnostics = buildImageQuickActionMacroPlaybackDiagnostics({
      macro: {
        id: 'macro-export',
        name: 'Export Cleanup',
        createdAt: 20,
        updatedAt: 30,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'missingFixedCommand' },
        ],
      },
      documents: [
        {
          ...createEmptyImageDocument({ id: 'doc-a', title: 'A Cover', width: 400, height: 300 }),
          layers: [makeLayer({ id: 'layer-a' })],
          activeLayerId: 'layer-a',
        },
      ],
      activeDocId: 'doc-a',
      supportedActionIds: ['nudgeLayerRightLarge'],
    });

    expect(diagnostics.nativeExecution).toEqual({
      supported: false,
      reason: 'Quick action macros are deterministic browser/store playback descriptors only; unattended native filesystem execution is not wired.',
      requiredWorkspace: 'image-automation',
    });
    expect(diagnostics.importExportUi).toEqual({
      manifestSchemaVersion: 1,
      canSerializeManifest: true,
      canParseManifest: true,
      hasDedicatedImportUi: false,
      hasDedicatedExportUi: false,
      gaps: [
        'No dedicated Image Automation import button is wired to macro manifests.',
        'No dedicated Image Automation export button is wired to macro manifests.',
      ],
    });
    expect(diagnostics.batchOpenDocuments).toEqual({
      supported: true,
      scope: 'currently-open-image-documents',
      documentCount: 1,
      attemptedDocumentCount: 0,
      blockedDocumentCount: 1,
      previewSignature: 'image-quick-action-playback-diagnostics:v1:{"macro":{"id":"macro-export","stepCount":2,"unavailableActionIds":["missingFixedCommand"]},"documents":[{"id":"doc-a","layerCount":1,"active":true,"canAttemptPlayback":false,"warningCodes":["unavailable-command"]}]}',
      deterministicRouteSignature: 'image-quick-action-open-doc-batch:v2:{"macroId":"macro-export","documentIds":["doc-a"],"attemptedDocumentIds":[],"blockedDocumentIds":["doc-a"],"unavailableActionIds":["missingFixedCommand"]}',
    });
    expect(diagnostics.fileFolderBatch).toEqual({
      supported: false,
      unsupportedInputKinds: ['file-list', 'folder'],
      caveats: [
        'File-list batch queues are not wired to quick-action macro playback.',
        'Folder input/output batch processing is not implemented for Image quick actions.',
        'Playback diagnostics only cover documents that are already open in the Image workspace.',
      ],
      warnings: [
        {
          code: 'file-folder-batch-unsupported',
          severity: 'warning',
          message: 'File/folder batch playback is not implemented; macro playback only targets currently open Image documents.',
        },
      ],
      readinessSignature: 'image-quick-action-file-folder-batch:v2:{"macroId":"macro-export","supported":false,"unsupportedInputKinds":["file-list","folder"],"openDocumentScope":"currently-open-image-documents"}',
    });
    expect(diagnostics.automationBoundary).toEqual({
      separateFromMainFlow: true,
      requiredWorkspace: 'image-automation',
      mainFlowCallable: false,
      reason: 'Quick action macro playback stays in Image Automation surfaces and does not become a main Flow node execution path.',
    });
    expect(diagnostics.workspaceHandoff).toEqual({
      workspaceId: 'image-automation',
      ready: false,
      handoffKind: 'macro-playback-preview',
      requiredPayloads: ['macro-manifest', 'open-document-targets', 'command-availability'],
      blockers: [
        'Native unattended execution is not implemented.',
        'Macro import/export UI is descriptor-only.',
        'One or more macro commands are unavailable.',
      ],
    });
    expect(diagnostics.preview).toMatchObject({
      id: 'image-quick-action-preview:macro-export:1-docs:1-unavailable',
      signature: 'image-quick-action-playback-diagnostics:v1:{"macro":{"id":"macro-export","stepCount":2,"unavailableActionIds":["missingFixedCommand"]},"documents":[{"id":"doc-a","layerCount":1,"active":true,"canAttemptPlayback":false,"warningCodes":["unavailable-command"]}]}',
    });
  });

  it('adds deterministic playback signatures, arbitrary-command caveats, and explicit automation-flow separation', () => {
    const diagnostics = buildImageQuickActionMacroPlaybackDiagnostics({
      macro: {
        id: 'macro-batch',
        name: 'Batch Cleanup',
        createdAt: 20,
        updatedAt: 30,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'missingFixedCommand' },
        ],
      },
      documents: [
        {
          ...createEmptyImageDocument({ id: 'doc-a', title: 'A Cover', width: 400, height: 300 }),
          layers: [makeLayer({ id: 'layer-a' })],
          activeLayerId: 'layer-a',
        },
        {
          ...createEmptyImageDocument({ id: 'doc-b', title: 'B Cover', width: 800, height: 600 }),
          layers: [],
          activeLayerId: null,
        },
      ],
      activeDocId: 'doc-a',
      supportedActionIds: ['nudgeLayerRightLarge'],
    });

    expect(diagnostics.commandRecordingCaveats).toEqual({
      arbitraryCommandsSupported: false,
      parameterizedStepsSupported: false,
      fixedQuickActionIdsOnly: true,
      message: 'Playback diagnostics assume fixed Sloom Studio quick action ids only; arbitrary commands and parameter payloads remain descriptor-only caveats.',
    });
    expect(diagnostics.batchOpenDocuments).toEqual({
      supported: true,
      scope: 'currently-open-image-documents',
      documentCount: 2,
      attemptedDocumentCount: 0,
      blockedDocumentCount: 2,
      previewSignature: 'image-quick-action-playback-diagnostics:v1:{"macro":{"id":"macro-batch","stepCount":2,"unavailableActionIds":["missingFixedCommand"]},"documents":[{"id":"doc-a","layerCount":1,"active":true,"canAttemptPlayback":false,"warningCodes":["unavailable-command"]},{"id":"doc-b","layerCount":0,"active":false,"canAttemptPlayback":false,"warningCodes":["no-active-layer","unavailable-command"]}]}',
      deterministicRouteSignature: 'image-quick-action-open-doc-batch:v2:{"macroId":"macro-batch","documentIds":["doc-a","doc-b"],"attemptedDocumentIds":[],"blockedDocumentIds":["doc-a","doc-b"],"unavailableActionIds":["missingFixedCommand"]}',
    });
    expect(diagnostics.fileFolderBatch).toEqual({
      supported: false,
      unsupportedInputKinds: ['file-list', 'folder'],
      caveats: [
        'File-list batch queues are not wired to quick-action macro playback.',
        'Folder input/output batch processing is not implemented for Image quick actions.',
        'Playback diagnostics only cover documents that are already open in the Image workspace.',
      ],
      warnings: [
        {
          code: 'file-folder-batch-unsupported',
          severity: 'warning',
          message: 'File/folder batch playback is not implemented; macro playback only targets currently open Image documents.',
        },
      ],
      readinessSignature: 'image-quick-action-file-folder-batch:v2:{"macroId":"macro-batch","supported":false,"unsupportedInputKinds":["file-list","folder"],"openDocumentScope":"currently-open-image-documents"}',
    });
    expect(diagnostics.automationBoundary).toEqual({
      separateFromMainFlow: true,
      requiredWorkspace: 'image-automation',
      mainFlowCallable: false,
      reason: 'Quick action macro playback stays in Image Automation surfaces and does not become a main Flow node execution path.',
    });
  });

  it('describes quick action mutability, undoability, native caveats, and stable signatures', () => {
    expect(describeImageQuickActionReadiness('nudgeLayerRightLarge')).toEqual({
      actionId: 'nudgeLayerRightLarge',
      label: 'Nudge Layer Right 10 px',
      supported: true,
      input: ['document', 'movableLayer'],
      output: 'transform',
      mutatesDocument: true,
      undoable: true,
      implementation: 'local-deterministic',
      warning: null,
      nativeExecutionCaveat: 'Native Photoshop action playback is not implemented; local browser/store playback is the only executable path.',
      signature: 'image-quick-action-readiness:v1:{"actionId":"nudgeLayerRightLarge","supported":true,"input":["document","movableLayer"],"output":"transform","mutatesDocument":true,"undoable":true,"implementation":"local-deterministic"}',
    });

    expect(describeImageQuickActionReadiness('unregisteredAction')).toEqual({
      actionId: 'unregisteredAction',
      label: 'unregisteredAction',
      supported: false,
      input: [],
      output: 'unknown',
      mutatesDocument: false,
      undoable: false,
      implementation: 'unsupported',
      warning: 'No local fixed quick action command is registered for this id.',
      nativeExecutionCaveat: 'Native Photoshop action playback is not implemented.',
      signature: 'image-quick-action-readiness:v1:{"actionId":"unregisteredAction","supported":false,"input":[],"output":"unknown","mutatesDocument":false,"undoable":false,"implementation":"unsupported"}',
    });
  });

  it('summarizes macro readiness with unsupported arbitrary command recording and document blockers', () => {
    const readyDoc = {
      ...createEmptyImageDocument({ id: 'doc-ready', title: 'Ready', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-ready' })],
      activeLayerId: 'layer-ready',
      hasSelection: true,
    };
    const blockedDoc = {
      ...createEmptyImageDocument({ id: 'doc-blocked', title: 'Blocked', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-blocked', locks: { position: true, pixels: true } })],
      activeLayerId: 'layer-blocked',
      hasSelection: false,
    };

    const readiness = buildImageQuickActionMacroReadiness({
      macro: {
        id: 'macro readiness',
        name: ' Macro Readiness ',
        steps: [
          { id: 'move', actionId: 'nudgeLayerRightLarge' },
          { id: 'clear', actionId: 'clearSelectedPixels' },
          { id: 'param', actionId: 'selectCanvas', params: { unsupported: true } },
          { id: 'missing', actionId: 'missingCommand' },
        ],
      },
      documents: [readyDoc, blockedDoc],
      activeDocId: 'doc-ready',
    });

    expect(readiness.descriptorId).toBe('image-quick-action-macro-readiness:v1');
    expect(readiness.macro).toEqual({
      id: 'macro-readiness',
      name: 'Macro Readiness',
      stepCount: 4,
      mutatesDocument: true,
      allStepsUndoable: false,
      signature: 'image-quick-action-macro:v1:{"id":"macro-readiness","name":"Macro Readiness","stepSignatures":["image-quick-action-recorded-step:v1:{\\"id\\":\\"move\\",\\"actionId\\":\\"nudgeLayerRightLarge\\",\\"supported\\":true,\\"hasUnsupportedParams\\":false,\\"input\\":[\\"document\\",\\"movableLayer\\"],\\"output\\":\\"transform\\",\\"mutatesDocument\\":true,\\"undoable\\":true,\\"blockerCodes\\":[]}","image-quick-action-recorded-step:v1:{\\"id\\":\\"clear\\",\\"actionId\\":\\"clearSelectedPixels\\",\\"supported\\":true,\\"hasUnsupportedParams\\":false,\\"input\\":[\\"document\\",\\"editablePixels\\",\\"selection\\"],\\"output\\":\\"paint\\",\\"mutatesDocument\\":true,\\"undoable\\":true,\\"blockerCodes\\":[]}","image-quick-action-recorded-step:v1:{\\"id\\":\\"param\\",\\"actionId\\":\\"selectCanvas\\",\\"supported\\":true,\\"hasUnsupportedParams\\":true,\\"input\\":[\\"document\\"],\\"output\\":\\"selection\\",\\"mutatesDocument\\":false,\\"undoable\\":true,\\"blockerCodes\\":[\\"unsupported-params\\"]}","image-quick-action-recorded-step:v1:{\\"id\\":\\"missing\\",\\"actionId\\":\\"missingCommand\\",\\"supported\\":false,\\"hasUnsupportedParams\\":false,\\"input\\":[],\\"output\\":\\"unknown\\",\\"mutatesDocument\\":false,\\"undoable\\":false,\\"blockerCodes\\":[\\"unsupported-action\\"]}"]}',
    });
    expect(readiness.recordedCommands.unsupportedArbitraryCommandRecording).toEqual({
      supported: false,
      reason: 'Macro recording stores fixed quick action command ids only; arbitrary command payloads are not executable.',
      supportedRecordingKinds: ['fixed-quick-action-id'],
      unsupportedStepIds: ['param'],
    });
    expect(readiness.recordedCommands.steps.map((step) => ({
      id: step.id,
      actionId: step.actionId,
      supported: step.supported,
      hasUnsupportedParams: step.hasUnsupportedParams,
      mutatesDocument: step.mutatesDocument,
      undoable: step.undoable,
      input: step.input,
      output: step.output,
      blockerCodes: step.blockers.map((blocker) => blocker.code),
    }))).toEqual([
      {
        id: 'move',
        actionId: 'nudgeLayerRightLarge',
        supported: true,
        hasUnsupportedParams: false,
        mutatesDocument: true,
        undoable: true,
        input: ['document', 'movableLayer'],
        output: 'transform',
        blockerCodes: [],
      },
      {
        id: 'clear',
        actionId: 'clearSelectedPixels',
        supported: true,
        hasUnsupportedParams: false,
        mutatesDocument: true,
        undoable: true,
        input: ['document', 'editablePixels', 'selection'],
        output: 'paint',
        blockerCodes: [],
      },
      {
        id: 'param',
        actionId: 'selectCanvas',
        supported: true,
        hasUnsupportedParams: true,
        mutatesDocument: false,
        undoable: true,
        input: ['document'],
        output: 'selection',
        blockerCodes: ['unsupported-params'],
      },
      {
        id: 'missing',
        actionId: 'missingCommand',
        supported: false,
        hasUnsupportedParams: false,
        mutatesDocument: false,
        undoable: false,
        input: [],
        output: 'unknown',
        blockerCodes: ['unsupported-action'],
      },
    ]);
    expect(readiness.batchPlayback).toMatchObject({
      ready: false,
      documentCount: 2,
      readyDocumentCount: 0,
      blockedDocumentCount: 2,
      unsupportedActionIds: ['missingCommand'],
      unsupportedParameterSteps: ['macro-readiness:param'],
      preview: {
        id: 'image-quick-action-open-documents-preview:macro-readiness:2-docs:7-blockers',
        signature: 'image-quick-action-open-documents:v1:{"macroId":"macro-readiness","documentSignatures":["image-quick-action-document-readiness:v1:{\\"id\\":\\"doc-blocked\\",\\"layerCount\\":1,\\"activeLayerId\\":\\"layer-blocked\\",\\"hasSelection\\":false,\\"blockerCodes\\":[\\"active-layer-position-locked\\",\\"active-layer-pixels-locked\\",\\"missing-selection\\",\\"unsupported-params\\",\\"unsupported-action\\"]}","image-quick-action-document-readiness:v1:{\\"id\\":\\"doc-ready\\",\\"layerCount\\":1,\\"activeLayerId\\":\\"layer-ready\\",\\"hasSelection\\":true,\\"blockerCodes\\":[\\"unsupported-params\\",\\"unsupported-action\\"]}"],"readyDocumentCount":0,"blockerCodes":["active-layer-position-locked","active-layer-pixels-locked","missing-selection","unsupported-params","unsupported-action","unsupported-params","unsupported-action"]}',
      },
      warnings: [
        {
          code: 'file-folder-batch-unsupported',
          severity: 'warning',
          message: 'Batch playback readiness covers currently open Image documents only; file and folder queues are not executable.',
        },
      ],
    });
    expect(readiness.fileFolderBatch).toEqual({
      supported: false,
      openDocumentPlaybackSupported: true,
      unsupportedInputKinds: ['file-list', 'folder'],
      caveats: [
        'Quick-action macro playback can iterate currently open Image documents.',
        'File-list batch queues are not wired to quick-action macro playback.',
        'Folder input/output batch processing is not implemented for Image quick actions.',
      ],
      warnings: [
        {
          code: 'file-folder-batch-unsupported',
          severity: 'warning',
          message: 'Batch playback readiness covers currently open Image documents only; file and folder queues are not executable.',
        },
      ],
    });
    expect(readiness.documents.map((doc) => ({
      id: doc.id,
      active: doc.active,
      ready: doc.ready,
      blockerCodes: doc.blockers.map((blocker) => blocker.code),
    }))).toEqual([
      {
        id: 'doc-blocked',
        active: false,
        ready: false,
        blockerCodes: [
          'active-layer-position-locked',
          'active-layer-pixels-locked',
          'missing-selection',
          'unsupported-params',
          'unsupported-action',
        ],
      },
      {
        id: 'doc-ready',
        active: true,
        ready: false,
        blockerCodes: ['unsupported-params', 'unsupported-action'],
      },
    ]);
    expect(readiness.nativeExecution).toEqual({
      supported: false,
      caveats: [
        'Native Photoshop action execution is not available.',
        'Local quick-action macro playback can mutate open Image documents through browser/store commands only.',
        'Batch playback readiness is a planning descriptor and does not launch unattended native automation.',
      ],
    });
    expect(readiness.signature).toContain('image-quick-action-macro-readiness:v1:');
    expect(readiness.signature).toContain('"unsupportedActionIds":["missingCommand"]');
  });

  it('checks macro compatibility per document with stable dashboard signatures', () => {
    const readyDoc = {
      ...createEmptyImageDocument({ id: 'doc-ready', title: 'Ready', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-ready' })],
      activeLayerId: 'layer-ready',
      hasSelection: true,
    };
    const blockedDoc = {
      ...createEmptyImageDocument({ id: 'doc-blocked', title: 'Blocked', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'layer-blocked', locks: { position: true, pixels: true } })],
      activeLayerId: 'layer-blocked',
      hasSelection: false,
    };

    const readiness = buildImageQuickActionMacroReadiness({
      macro: {
        id: 'macro-compat',
        name: 'Compatibility',
        steps: [
          { id: 'move', actionId: 'nudgeLayerRightLarge' },
          { id: 'clear', actionId: 'clearSelectedPixels' },
        ],
      },
      documents: [readyDoc, blockedDoc],
      activeDocId: 'doc-ready',
    });

    expect(readiness.documents.map((doc) => ({
      id: doc.id,
      ready: doc.ready,
      compatibility: doc.compatibility,
    }))).toEqual([
      {
        id: 'doc-blocked',
        ready: false,
        compatibility: {
          state: 'blocked',
          compatible: false,
          stepCount: 2,
          compatibleStepCount: 0,
          blockedStepCount: 2,
          unsupportedActionIds: [],
          unsupportedParameterStepIds: [],
          missingRequiredInputs: [
            'active-layer-position-locked',
            'active-layer-pixels-locked',
            'missing-selection',
          ],
          requiredInputs: ['document', 'editablePixels', 'movableLayer', 'selection'],
          outputKinds: ['paint', 'transform'],
          stepChecks: [
            {
              stepId: 'move',
              actionId: 'nudgeLayerRightLarge',
              compatible: false,
              requiredInputs: ['document', 'movableLayer'],
              output: 'transform',
              blockerCodes: ['active-layer-position-locked'],
              signature: 'image-quick-action-step-document-compatibility:v1:{"documentId":"doc-blocked","macroId":"macro-compat","stepId":"move","actionId":"nudgeLayerRightLarge","compatible":false,"blockerCodes":["active-layer-position-locked"]}',
            },
            {
              stepId: 'clear',
              actionId: 'clearSelectedPixels',
              compatible: false,
              requiredInputs: ['document', 'editablePixels', 'selection'],
              output: 'paint',
              blockerCodes: ['active-layer-pixels-locked', 'missing-selection'],
              signature: 'image-quick-action-step-document-compatibility:v1:{"documentId":"doc-blocked","macroId":"macro-compat","stepId":"clear","actionId":"clearSelectedPixels","compatible":false,"blockerCodes":["active-layer-pixels-locked","missing-selection"]}',
            },
          ],
          signature: 'image-quick-action-document-compatibility:v1:{"documentId":"doc-blocked","macroId":"macro-compat","stepChecks":[{"stepId":"move","actionId":"nudgeLayerRightLarge","compatible":false,"blockerCodes":["active-layer-position-locked"]},{"stepId":"clear","actionId":"clearSelectedPixels","compatible":false,"blockerCodes":["active-layer-pixels-locked","missing-selection"]}]}',
        },
      },
      {
        id: 'doc-ready',
        ready: true,
        compatibility: {
          state: 'compatible',
          compatible: true,
          stepCount: 2,
          compatibleStepCount: 2,
          blockedStepCount: 0,
          unsupportedActionIds: [],
          unsupportedParameterStepIds: [],
          missingRequiredInputs: [],
          requiredInputs: ['document', 'editablePixels', 'movableLayer', 'selection'],
          outputKinds: ['paint', 'transform'],
          stepChecks: [
            {
              stepId: 'move',
              actionId: 'nudgeLayerRightLarge',
              compatible: true,
              requiredInputs: ['document', 'movableLayer'],
              output: 'transform',
              blockerCodes: [],
              signature: 'image-quick-action-step-document-compatibility:v1:{"documentId":"doc-ready","macroId":"macro-compat","stepId":"move","actionId":"nudgeLayerRightLarge","compatible":true,"blockerCodes":[]}',
            },
            {
              stepId: 'clear',
              actionId: 'clearSelectedPixels',
              compatible: true,
              requiredInputs: ['document', 'editablePixels', 'selection'],
              output: 'paint',
              blockerCodes: [],
              signature: 'image-quick-action-step-document-compatibility:v1:{"documentId":"doc-ready","macroId":"macro-compat","stepId":"clear","actionId":"clearSelectedPixels","compatible":true,"blockerCodes":[]}',
            },
          ],
          signature: 'image-quick-action-document-compatibility:v1:{"documentId":"doc-ready","macroId":"macro-compat","stepChecks":[{"stepId":"move","actionId":"nudgeLayerRightLarge","compatible":true,"blockerCodes":[]},{"stepId":"clear","actionId":"clearSelectedPixels","compatible":true,"blockerCodes":[]}]}',
        },
      },
    ]);
    expect(readiness.compatibilitySummary).toEqual({
      readyDocumentIds: ['doc-ready'],
      blockedDocumentIds: ['doc-blocked'],
      documentCompatibilitySignatures: [
        'image-quick-action-document-compatibility:v1:{"documentId":"doc-blocked","macroId":"macro-compat","stepChecks":[{"stepId":"move","actionId":"nudgeLayerRightLarge","compatible":false,"blockerCodes":["active-layer-position-locked"]},{"stepId":"clear","actionId":"clearSelectedPixels","compatible":false,"blockerCodes":["active-layer-pixels-locked","missing-selection"]}]}',
        'image-quick-action-document-compatibility:v1:{"documentId":"doc-ready","macroId":"macro-compat","stepChecks":[{"stepId":"move","actionId":"nudgeLayerRightLarge","compatible":true,"blockerCodes":[]},{"stepId":"clear","actionId":"clearSelectedPixels","compatible":true,"blockerCodes":[]}]}',
      ],
      signature: 'image-quick-action-document-compatibility-summary:v1:{"macroId":"macro-compat","readyDocumentIds":["doc-ready"],"blockedDocumentIds":["doc-blocked"],"documentCompatibilitySignatures":["image-quick-action-document-compatibility:v1:{\\"documentId\\":\\"doc-blocked\\",\\"macroId\\":\\"macro-compat\\",\\"stepChecks\\":[{\\"stepId\\":\\"move\\",\\"actionId\\":\\"nudgeLayerRightLarge\\",\\"compatible\\":false,\\"blockerCodes\\":[\\"active-layer-position-locked\\"]},{\\"stepId\\":\\"clear\\",\\"actionId\\":\\"clearSelectedPixels\\",\\"compatible\\":false,\\"blockerCodes\\":[\\"active-layer-pixels-locked\\",\\"missing-selection\\"]}]}","image-quick-action-document-compatibility:v1:{\\"documentId\\":\\"doc-ready\\",\\"macroId\\":\\"macro-compat\\",\\"stepChecks\\":[{\\"stepId\\":\\"move\\",\\"actionId\\":\\"nudgeLayerRightLarge\\",\\"compatible\\":true,\\"blockerCodes\\":[]},{\\"stepId\\":\\"clear\\",\\"actionId\\":\\"clearSelectedPixels\\",\\"compatible\\":true,\\"blockerCodes\\":[]}]}"]}',
    });
    expect(readiness.dashboardSignatures).toEqual({
      macro: readiness.macro.signature,
      batchPlayback: readiness.batchPlayback.preview.signature,
      documentCompatibility: readiness.compatibilitySummary.signature,
      nativeExecution: 'image-quick-action-native-execution:v1:{"supported":false,"scope":"image-automation","filesystemExecution":false}',
      checklist: `image-quick-action-dashboard:v1:${JSON.stringify({
        macro: readiness.macro.signature,
        documentCompatibility: readiness.compatibilitySummary.signature,
        nativeExecution: 'image-quick-action-native-execution:v1:{"supported":false,"scope":"image-automation","filesystemExecution":false}',
      })}`,
    });
  });

  it('exposes macro import validation and per-step dry-run playback log readiness', () => {
    const diagnostics = buildImageQuickActionMacroPlaybackDiagnostics({
      macro: {
        id: 'macro-log',
        name: 'Loggable Macro',
        createdAt: 10,
        updatedAt: 12,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'missingFixedCommand' },
        ],
      },
      documents: [
        {
          ...createEmptyImageDocument({ id: 'doc-a', title: 'A Cover', width: 400, height: 300 }),
          layers: [makeLayer({ id: 'layer-a' })],
          activeLayerId: 'layer-a',
        },
      ],
      activeDocId: 'doc-a',
      supportedActionIds: ['nudgeLayerRightLarge'],
    });

    expect(diagnostics.macroRunIdentity).toEqual({
      macroId: 'macro-log',
      actionSetId: 'image-quick-action-macro-set:macro-log:2-steps',
      runId: 'image-quick-action-run:macro-log:1-docs:1-unavailable',
      signature: 'image-quick-action-run-identity:v1:{"macroId":"macro-log","documentIds":["doc-a"],"stepActionIds":["nudgeLayerRightLarge","missingFixedCommand"],"unavailableActionIds":["missingFixedCommand"]}',
    });
    expect(diagnostics.importValidation).toEqual({
      schemaVersion: 1,
      state: 'valid-with-warnings',
      valid: false,
      issueCodes: ['missing-action-id'],
      missingActionIds: ['missingFixedCommand'],
      duplicateStepIds: [],
      unsupportedParameterSteps: [],
      warnings: [
        {
          code: 'unavailable-command',
          severity: 'warning',
          actionId: 'missingFixedCommand',
          message: 'Quick action command missingFixedCommand is not available for playback.',
        },
      ],
      signature: 'image-quick-action-import-validation:v1:{"schemaVersion":1,"macroId":"macro-log","issueCodes":["missing-action-id"],"missingActionIds":["missingFixedCommand"],"duplicateStepIds":[],"unsupportedParameterSteps":[]}',
    });
    expect(diagnostics.stepExecutionLog).toEqual({
      runId: diagnostics.macroRunIdentity.runId,
      mode: 'dry-run',
      status: 'blocked',
      entries: [
        {
          id: 'image-quick-action-log:001:doc-a:step-1',
          documentId: 'doc-a',
          stepId: 'step-1',
          actionId: 'nudgeLayerRightLarge',
          status: 'dry-run',
          executed: false,
          warnings: [],
          signature: 'image-quick-action-step-log:v1:{"runId":"image-quick-action-run:macro-log:1-docs:1-unavailable","documentId":"doc-a","stepId":"step-1","actionId":"nudgeLayerRightLarge","status":"dry-run","executed":false,"warningCodes":[]}',
        },
        {
          id: 'image-quick-action-log:002:doc-a:step-2',
          documentId: 'doc-a',
          stepId: 'step-2',
          actionId: 'missingFixedCommand',
          status: 'unavailable',
          executed: false,
          warnings: [
            {
              code: 'unavailable-command',
              severity: 'warning',
              actionId: 'missingFixedCommand',
              message: 'Quick action command missingFixedCommand is not available for playback.',
            },
          ],
          signature: 'image-quick-action-step-log:v1:{"runId":"image-quick-action-run:macro-log:1-docs:1-unavailable","documentId":"doc-a","stepId":"step-2","actionId":"missingFixedCommand","status":"unavailable","executed":false,"warningCodes":["unavailable-command"]}',
        },
      ],
      unsupportedExecution: {
        nativeFilesystemExecution: false,
        unattendedBackgroundExecution: false,
        arbitraryPluginCommands: false,
        fullPhotoshopActions: false,
      },
      signature: 'image-quick-action-step-execution-log:v1:{"runId":"image-quick-action-run:macro-log:1-docs:1-unavailable","mode":"dry-run","status":"blocked","entryIds":["image-quick-action-log:001:doc-a:step-1","image-quick-action-log:002:doc-a:step-2"]}',
    });
  });
});
