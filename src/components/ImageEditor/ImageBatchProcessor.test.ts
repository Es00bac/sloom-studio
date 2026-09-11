import { describe, expect, it } from 'vitest';
import {
  buildImageBatchActionSetManifest,
  buildImageBatchPlan,
  parseImageBatchActionSetManifest,
  serializeImageBatchActionSetManifest,
} from './ImageBatchProcessor';

describe('ImageBatchProcessor', () => {
  it('exports and re-imports a deterministic action-set manifest', () => {
    const manifest = buildImageBatchActionSetManifest({
      macroIds: ['macro-b', 'macro-a', 'macro-a'],
      actionIds: ['action-b', 'action-a', 'action-b'],
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      macroIds: ['macro-b', 'macro-a'],
      actionIds: ['action-b', 'action-a'],
    });
    const serialized = serializeImageBatchActionSetManifest(manifest);
    expect(serialized).toBe(
      '{"schemaVersion":1,"macroIds":["macro-b","macro-a"],"actionIds":["action-b","action-a"]}',
    );
    expect(parseImageBatchActionSetManifest(serialized)).toEqual(manifest);
    expect(parseImageBatchActionSetManifest('bad-json')).toBeNull();
  });

  it('validates action-set references when registries are supplied and keeps a resolved manifest in the plan', () => {
    const manifest = buildImageBatchActionSetManifest({
      macroIds: ['macro-cleanup', 'macro-missing'],
      actionIds: ['flattenVisible', 'action-missing'],
    });
    const plan = buildImageBatchPlan({
      files: [{ id: 'file-a', path: '/jobs/input/hero.png' }],
      macroIds: manifest.macroIds,
      actionIds: manifest.actionIds,
      availableMacroIds: ['macro-cleanup'],
      availableActionIds: ['flattenVisible'],
      output: {
        folderPath: '/jobs/output',
        format: 'png',
      },
    });

    expect(plan.actionSet).toMatchObject({
      missingMacroIds: ['macro-missing'],
      missingActionIds: ['action-missing'],
      resolved: {
        macroIds: ['macro-cleanup'],
        actionIds: ['flattenVisible'],
      },
    });
    expect(plan.operations).toEqual([
      { kind: 'macro', id: 'macro-cleanup' },
      { kind: 'quick-action', id: 'flattenVisible' },
    ]);
    expect(plan.items[0]).toMatchObject({
      unavailableCommandWarnings: [
        {
          code: 'missing-macro',
          severity: 'warning',
          id: 'macro-missing',
          message: 'Batch macro macro-missing is unavailable and will be skipped.',
        },
        {
          code: 'missing-quick-action',
          severity: 'warning',
          id: 'action-missing',
          message: 'Batch quick action action-missing is unavailable and will be skipped.',
        },
      ],
      audit: {
        actionSet: {
          missingMacroIds: ['macro-missing'],
          missingActionIds: ['action-missing'],
          resolved: {
            macroIds: ['macro-cleanup'],
            actionIds: ['flattenVisible'],
          },
          requested: {
            macroIds: ['macro-cleanup', 'macro-missing'],
            actionIds: ['flattenVisible', 'action-missing'],
          },
        },
      },
    });
    expect(plan.queueAuditSummary).toEqual({
      requestedFiles: 1,
      plannedItems: 1,
      skippedFiles: 0,
      conflictDecisions: {
        none: 1,
        renamed: 0,
        overwritten: 0,
        skipped: 0,
      },
      skippedReasons: {},
      unavailableCommandCount: 2,
      outputFormats: ['png'],
    });
    expect(plan.preview).toEqual({
      id: 'image-batch-preview:1-planned:0-skipped:2-unavailable',
      signature: 'image-batch-plan:v1:{"operations":[{"kind":"macro","id":"macro-cleanup"},{"kind":"quick-action","id":"flattenVisible"}],"output":{"folderPath":"/jobs/output","format":"png","filenamePattern":"{basename}-{operation}.{ext}","preserveFolderStructure":false,"conflictStrategy":"suffix"},"items":[{"fileId":"file-a","inputPath":"/jobs/input/hero.png","outputPath":"/jobs/output/hero-macro-cleanup+flattenVisible.png","outputFormat":"png","conflictDecision":"none"}],"skipped":[],"missing":{"macroIds":["macro-missing"],"actionIds":["action-missing"]}}',
      sampleOutputPaths: ['/jobs/output/hero-macro-cleanup+flattenVisible.png'],
      auditLabel: '1 planned / 0 skipped / 2 unavailable commands',
    });
  });

  it('builds a deterministic dry-run plan for direct files and folder-backed records', () => {
    const plan = buildImageBatchPlan({
      files: [
        { id: 'file-z', path: '/jobs/input/Zebra.PNG', sizeBytes: 12_000 },
        { id: 'file-a', path: '/jobs/input/set/A panel.jpg', folderId: 'folder-1', relativePath: 'set/A panel.jpg' },
        { id: 'file-b', path: '/jobs/input/set/B panel.psd', folderId: 'folder-1', relativePath: 'set/B panel.psd' },
      ],
      folders: [{ id: 'folder-1', path: '/jobs/input', label: 'Issue 1' }],
      macroIds: ['macro-cleanup'],
      actionIds: ['flattenVisible'],
      output: {
        folderPath: '/jobs/output',
        format: 'png',
        filenamePattern: '{relativeDir}/{basename}-{operation}-{index}.{ext}',
        preserveFolderStructure: true,
        conflictStrategy: 'suffix',
      },
    });

    expect(plan.mode).toBe('dry-run');
    expect(plan.operations).toEqual([
      { kind: 'macro', id: 'macro-cleanup' },
      { kind: 'quick-action', id: 'flattenVisible' },
    ]);
    expect(plan.items.map((item) => ({
      inputPath: item.inputPath,
      outputPath: item.outputPath,
      sourceLabel: item.sourceLabel,
    }))).toEqual([
      {
        inputPath: '/jobs/input/Zebra.PNG',
        outputPath: '/jobs/output/Zebra-macro-cleanup+flattenVisible-001.png',
        sourceLabel: 'Direct files',
      },
      {
        inputPath: '/jobs/input/set/A panel.jpg',
        outputPath: '/jobs/output/set/A panel-macro-cleanup+flattenVisible-002.png',
        sourceLabel: 'Issue 1',
      },
      {
        inputPath: '/jobs/input/set/B panel.psd',
        outputPath: '/jobs/output/set/B panel-macro-cleanup+flattenVisible-003.png',
        sourceLabel: 'Issue 1',
      },
    ]);
    expect(plan.totals).toEqual({
      requestedFiles: 3,
      plannedItems: 3,
      skippedFiles: 0,
      macroCount: 1,
      quickActionCount: 1,
    });
  });

  it('skips unsupported inputs and duplicate paths without planning unattended execution', () => {
    const plan = buildImageBatchPlan({
      files: [
        { id: 'raw-1', path: '/jobs/input/frame.CR3' },
        { id: 'png-1', path: '/jobs/input/frame.png' },
        { id: 'png-dupe', path: '/jobs/input/./frame.png' },
      ],
      macroIds: [],
      actionIds: ['autoContrast'],
      output: { folderPath: '/jobs/output' },
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      inputPath: '/jobs/input/frame.png',
      outputPath: '/jobs/output/frame-autoContrast.png',
      executionStatus: 'not-run',
    });
    expect(plan.skipped).toMatchObject([
      {
        fileId: 'raw-1',
        inputPath: '/jobs/input/frame.CR3',
        reason: 'unsupported-extension',
        detail: 'CR3 is not supported by the dry-run batch planner.',
      },
      {
        fileId: 'png-dupe',
        inputPath: '/jobs/input/frame.png',
        reason: 'duplicate-path',
        detail: 'A file with this normalized path is already planned.',
      },
    ]);
    expect(plan.canExecuteUnattended).toBe(false);
    expect(plan.auditLogLevel).toBe('summary');
  });

  it('models output-name conflicts deterministically with suffix/overwrite/skip', () => {
    const suffixPlan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/base/A.png' },
        { id: 'file-2', path: '/jobs/input/base/nested/A.png' },
      ],
      output: {
        folderPath: '/jobs/output',
        filenamePattern: '{basename}.{ext}',
        conflictStrategy: 'suffix',
      },
    });

    expect(suffixPlan.items).toHaveLength(2);
    expect(suffixPlan.items[0]).toMatchObject({
      outputPath: '/jobs/output/A.png',
      audit: expect.objectContaining({
        conflictDecision: 'none',
        outputConflictStrategy: 'suffix',
      }),
    });
    expect(suffixPlan.items[1]).toMatchObject({
      outputPath: '/jobs/output/A-2.png',
      audit: expect.objectContaining({
        conflictDecision: 'renamed',
        outputConflictStrategy: 'suffix',
      }),
    });

    const overwritePlan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/base/A.png' },
        { id: 'file-2', path: '/jobs/input/base/nested/A.png' },
      ],
      output: {
        folderPath: '/jobs/output',
        filenamePattern: '{basename}.{ext}',
        conflictStrategy: 'overwrite',
      },
    });

    expect(overwritePlan.items).toHaveLength(2);
    expect(overwritePlan.items[0].outputPath).toBe('/jobs/output/A.png');
    expect(overwritePlan.items[1]).toMatchObject({
      outputPath: '/jobs/output/A.png',
      audit: expect.objectContaining({
        conflictDecision: 'overwritten',
        outputConflictStrategy: 'overwrite',
      }),
    });

    const skipPlan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/base/A.png' },
        { id: 'file-2', path: '/jobs/input/base/nested/A.png' },
      ],
      output: {
        folderPath: '/jobs/output',
        filenamePattern: '{basename}.{ext}',
        conflictStrategy: 'skip',
      },
    });

    expect(skipPlan.items).toHaveLength(1);
    expect(skipPlan.skipped).toMatchObject([
      {
        fileId: 'file-2',
        inputPath: '/jobs/input/base/nested/A.png',
        reason: 'output-path-conflict',
        detail: 'Planned output path /jobs/output/A.png already exists; conflict strategy is skip.',
      },
    ]);
  });

  it('describes queue readiness, retry policy, log limits, and automation handoff deterministically', () => {
    const plan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/base/A.png' },
        { id: 'file-2', path: '/jobs/input/base/nested/A.png' },
        { id: 'raw-1', path: '/jobs/input/base/raw.CR3' },
      ],
      macroIds: ['macro-cleanup', 'macro-missing'],
      actionIds: ['flattenVisible'],
      availableMacroIds: ['macro-cleanup'],
      availableActionIds: ['flattenVisible'],
      output: {
        folderPath: '/jobs/output',
        filenamePattern: '{basename}.{ext}',
        conflictStrategy: 'suffix',
      },
    });

    expect(plan.nativeExecution).toEqual({
      supported: false,
      reason: 'Image batch plans are deterministic dry-run descriptors; native unattended execution is not wired.',
      requiredWorkspace: 'image-automation',
    });
    expect(plan.queueReadiness).toEqual({
      ready: true,
      sourceKinds: ['file'],
      folderCount: 0,
      fileCount: 3,
      plannedFileCount: 2,
      skippedFileCount: 1,
      outputFolderReady: true,
      hasExecutableActionSet: true,
      blockers: [],
      warnings: [
        '1 input file is skipped before execution.',
        '1 action-set entry is unavailable and will be skipped.',
      ],
    });
    expect(plan.executionLogPolicy).toEqual({
      level: 'summary',
      maxEntries: 500,
      retention: 'current-session',
      includesSkippedItems: true,
      includesOutputConflicts: true,
    });
    expect(plan.retryPolicy).toEqual({
      maxAttempts: 1,
      retryableErrors: [],
      stopOnFirstError: false,
      recordsPerItemErrors: true,
      unsupportedReason: 'Retry execution is not available until native batch running is implemented.',
    });
    expect(plan.outputNamingPolicy).toEqual({
      filenamePattern: '{basename}.{ext}',
      conflictStrategy: 'suffix',
      collisionPolicy: 'append-numeric-suffix',
      preservesFolderStructure: false,
      namingTokens: ['{basename}', '{ext}', '{index}', '{operation}', '{relativeDir}', '{fileId}'],
      outputFolder: {
        path: '/jobs/output',
        writeState: 'requires-user-confirmed-directory-handle',
        nativeWriteSupported: false,
      },
      sampleCollisions: [
        {
          requestedPath: '/jobs/output/A.png',
          resolvedPath: '/jobs/output/A-2.png',
          decision: 'renamed',
        },
      ],
      collisionChecks: {
        collisionCount: 1,
        decisions: {
          renamed: 1,
          overwritten: 0,
          skipped: 0,
        },
        signature: 'image-batch-output-collisions:v1:{"conflictStrategy":"suffix","collisions":[{"requestedPath":"/jobs/output/A.png","resolvedPath":"/jobs/output/A-2.png","decision":"renamed"}]}',
      },
      signature: 'image-batch-output-naming:v1:{"folderPath":"/jobs/output","filenamePattern":"{basename}.{ext}","format":"source","preserveFolderStructure":false,"conflictStrategy":"suffix","collisionPolicy":"append-numeric-suffix","sampleCollisions":[{"requestedPath":"/jobs/output/A.png","resolvedPath":"/jobs/output/A-2.png","decision":"renamed"}]}',
    });
    expect(plan.workspaceHandoff).toEqual({
      workspaceId: 'image-automation',
      ready: true,
      handoffKind: 'batch-plan-preview',
      requiredPayloads: ['input-file-queue', 'action-set-manifest', 'output-options'],
      blockers: [],
    });
    expect(plan.fileAccess).toEqual({
      capabilities: {
        directFileListInput: true,
        folderInput: true,
        folderOutput: true,
        perFileOutputDescriptors: true,
        writesDuringDryRun: false,
      },
      inputSources: [
        {
          kind: 'direct-files',
          count: 3,
          readState: 'queued-from-browser-or-native-picker',
          caveats: ['Direct file records are descriptor references; bytes are not read during planning.'],
        },
      ],
      outputTarget: {
        kind: 'output-folder',
        path: '/jobs/output',
        writeState: 'requires-user-confirmed-directory-handle',
        overwritePolicy: 'suffix',
        caveats: [
          'Directory writes are unsupported in this dry-run plan until a browser File System Access or native save adapter is wired.',
          'The planner can name outputs but cannot create folders or replace files.',
        ],
      },
    });
    expect(plan.variableFillPlan).toEqual({
      state: 'available-for-review',
      bindingReadiness: 'ready-for-explicit-review',
      aiAssist: 'planned-not-executed',
      requiredReview: true,
      fillSources: ['metadata', 'filename'],
      supportsOutputNamingBindings: true,
      supportsMacroPlaceholderBindings: true,
      supportsArbitraryJsExpressions: false,
      caveats: [
        'AI-assisted variable fills are planning descriptors only and do not call a provider.',
        'Variables must be reviewed before they can drive output naming or macro placeholders.',
      ],
      algorithmicFill: {
        supported: true,
        deterministic: true,
        sources: ['filename', 'metadata'],
        availableBindings: [
          { token: '{basename}', source: 'filename', target: 'output-naming' },
          { token: '{relativeDir}', source: 'filename', target: 'output-naming' },
          { token: '{index}', source: 'metadata', target: 'output-naming' },
          { token: '{fileId}', source: 'metadata', target: 'output-naming' },
        ],
        signature: 'image-batch-variable-fill-algorithmic:v1:{"sources":["filename","metadata"],"bindings":["{basename}","{relativeDir}","{index}","{fileId}"]}',
      },
      aiFill: {
        state: 'planned-not-executed',
        providerCallsDuringPlanning: false,
        sources: ['ai-description'],
        reviewRequired: true,
        unsupportedExecutionReason: 'AI-assisted variable fills are metadata plans only until a reviewed runner is wired.',
        signature: 'image-batch-variable-fill-ai:v1:{"state":"planned-not-executed","providerCallsDuringPlanning":false,"sources":["ai-description"],"reviewRequired":true}',
      },
      signature: 'image-batch-variable-fill:v1:{"bindingReadiness":"ready-for-explicit-review","algorithmicSources":["filename","metadata"],"aiAssist":"planned-not-executed","reviewRequired":true,"arbitraryJs":false}',
    });
    expect(plan.actionMacroHandoff).toEqual({
      state: 'ready',
      automationSurface: {
        workspaceId: 'image-automation',
        surface: 'folder-list-batch',
        separateFromMainFlow: true,
      },
      macroIds: ['macro-cleanup'],
      quickActionIds: ['flattenVisible'],
      skippedMacroIds: ['macro-missing'],
      skippedQuickActionIds: [],
      callableOperations: [
        {
          kind: 'macro',
          id: 'macro-cleanup',
          source: 'saved-macro',
          callable: true,
        },
        {
          kind: 'quick-action',
          id: 'flattenVisible',
          source: 'suite-native-quick-action',
          callable: true,
        },
        {
          kind: 'macro',
          id: 'macro-missing',
          source: 'saved-macro',
          callable: false,
          reason: 'missing-from-registry',
        },
      ],
      handoffPayloads: ['action-set-manifest', 'image-batch-items', 'output-naming-policy'],
      caveats: ['Macro and quick-action execution remains an Image Automation handoff, not a main Flow node execution.'],
    });
    expect(plan.nativeExecutionState).toEqual({
      state: 'unsupported',
      canRunNow: false,
      unsupportedReasons: ['native-batch-runner-not-wired', 'directory-write-adapter-not-wired'],
      nextSupportedState: 'preview-ready',
      unsupportedArbitraryJsState: {
        supported: false,
        reason: 'Only suite-native macro and quick-action ids are callable; arbitrary JavaScript state is unsupported.',
      },
      filesystemStates: [
        {
          operation: 'read-folder-queue',
          supported: false,
          state: 'requires-user-confirmed-directory-handle',
          canExecuteInDryRun: false,
          reason: 'Folder queue reads are represented by selected file records; the planner does not crawl native directories.',
        },
        {
          operation: 'write-output-folder',
          supported: false,
          state: 'unsupported-native-adapter-missing',
          canExecuteInDryRun: false,
          reason: 'Output folder writes require a future browser or native filesystem adapter.',
        },
        {
          operation: 'create-collision-safe-output',
          supported: false,
          state: 'planned-metadata-only',
          canExecuteInDryRun: false,
          reason: 'Collision-safe names are planned deterministically but files and directories are not created.',
        },
      ],
      signature: 'image-batch-native-execution:v1:{"state":"unsupported","unsupportedReasons":["native-batch-runner-not-wired","directory-write-adapter-not-wired"],"filesystemStates":["read-folder-queue:requires-user-confirmed-directory-handle","write-output-folder:unsupported-native-adapter-missing","create-collision-safe-output:planned-metadata-only"]}',
    });
    expect(plan.progressEvidence).toEqual({
      state: 'planned',
      plannedCount: 2,
      skippedCount: 1,
      completedCount: 0,
      failedCount: 0,
      evidenceLevel: 'plan-only',
      auditSummary: '2 planned / 1 skipped / 1 unavailable commands',
      sampleOutputPaths: ['/jobs/output/A.png', '/jobs/output/A-2.png'],
      dryRunDiagnostics: {
        scope: 'multiple-documents',
        safe: true,
        canMutateDocuments: false,
        documentCount: 3,
        plannedDocumentCount: 2,
        skippedDocumentCount: 1,
        sampleInputPaths: [
          '/jobs/input/base/A.png',
          '/jobs/input/base/nested/A.png',
          '/jobs/input/base/raw.CR3',
        ],
      },
    });
    expect(plan.preview).toMatchObject({
      id: 'image-batch-preview:2-planned:1-skipped:1-unavailable',
      signature: 'image-batch-plan:v1:{"operations":[{"kind":"macro","id":"macro-cleanup"},{"kind":"quick-action","id":"flattenVisible"}],"output":{"folderPath":"/jobs/output","format":"source","filenamePattern":"{basename}.{ext}","preserveFolderStructure":false,"conflictStrategy":"suffix"},"items":[{"fileId":"file-1","inputPath":"/jobs/input/base/A.png","outputPath":"/jobs/output/A.png","outputFormat":"png","conflictDecision":"none"},{"fileId":"file-2","inputPath":"/jobs/input/base/nested/A.png","outputPath":"/jobs/output/A-2.png","outputFormat":"png","conflictDecision":"renamed"}],"skipped":[{"fileId":"raw-1","inputPath":"/jobs/input/base/raw.CR3","reason":"unsupported-extension","conflictDecision":"none"}],"missing":{"macroIds":["macro-missing"],"actionIds":[]}}',
    });
    expect(plan.queuePlanning).toEqual({
      descriptorId: 'image-batch-queue-planning:v1',
      imageOnly: true,
      workspaceId: 'image-automation',
      separateFromMainFlow: true,
      inputMode: 'file-list',
      directFileQueue: {
        count: 3,
        fileIds: ['file-1', 'file-2', 'raw-1'],
      },
      folderQueues: [],
      plannedFileIds: ['file-1', 'file-2'],
      skippedFileIds: ['raw-1'],
      checks: {
        hasInputFiles: true,
        hasOutputFolder: true,
        hasExecutableActionSet: true,
        unsupportedInputCount: 1,
        duplicateInputCount: 0,
        outputConflictCount: 1,
        ready: true,
      },
      signature: 'image-batch-queue-planning:v1:{"workspaceId":"image-automation","inputMode":"file-list","directFileIds":["file-1","file-2","raw-1"],"folderQueues":[],"plannedFileIds":["file-1","file-2"],"skipped":[{"fileId":"raw-1","reason":"unsupported-extension"}],"checks":{"hasInputFiles":true,"hasOutputFolder":true,"hasExecutableActionSet":true,"unsupportedInputCount":1,"duplicateInputCount":0,"outputConflictCount":1,"ready":true}}',
    });
    expect(plan.dashboardSignatures).toEqual({
      queue: plan.queuePlanning.signature,
      outputNaming: plan.outputNamingPolicy.signature,
      variableFill: plan.variableFillPlan.signature,
      nativeExecution: plan.nativeExecutionState.signature,
      preview: plan.preview.signature,
      checklist: 'image-batch-dashboard:v1:{"queue":"image-batch-queue-planning:v1:{\\"workspaceId\\":\\"image-automation\\",\\"inputMode\\":\\"file-list\\",\\"directFileIds\\":[\\"file-1\\",\\"file-2\\",\\"raw-1\\"],\\"folderQueues\\":[],\\"plannedFileIds\\":[\\"file-1\\",\\"file-2\\"],\\"skipped\\":[{\\"fileId\\":\\"raw-1\\",\\"reason\\":\\"unsupported-extension\\"}],\\"checks\\":{\\"hasInputFiles\\":true,\\"hasOutputFolder\\":true,\\"hasExecutableActionSet\\":true,\\"unsupportedInputCount\\":1,\\"duplicateInputCount\\":0,\\"outputConflictCount\\":1,\\"ready\\":true}}","outputNaming":"image-batch-output-naming:v1:{\\"folderPath\\":\\"/jobs/output\\",\\"filenamePattern\\":\\"{basename}.{ext}\\",\\"format\\":\\"source\\",\\"preserveFolderStructure\\":false,\\"conflictStrategy\\":\\"suffix\\",\\"collisionPolicy\\":\\"append-numeric-suffix\\",\\"sampleCollisions\\":[{\\"requestedPath\\":\\"/jobs/output/A.png\\",\\"resolvedPath\\":\\"/jobs/output/A-2.png\\",\\"decision\\":\\"renamed\\"}]}","variableFill":"image-batch-variable-fill:v1:{\\"bindingReadiness\\":\\"ready-for-explicit-review\\",\\"algorithmicSources\\":[\\"filename\\",\\"metadata\\"],\\"aiAssist\\":\\"planned-not-executed\\",\\"reviewRequired\\":true,\\"arbitraryJs\\":false}","nativeExecution":"image-batch-native-execution:v1:{\\"state\\":\\"unsupported\\",\\"unsupportedReasons\\":[\\"native-batch-runner-not-wired\\",\\"directory-write-adapter-not-wired\\"],\\"filesystemStates\\":[\\"read-folder-queue:requires-user-confirmed-directory-handle\\",\\"write-output-folder:unsupported-native-adapter-missing\\",\\"create-collision-safe-output:planned-metadata-only\\"]}"}',
    });
  });

  it('models folder/list automation as a separate image automation surface with callable suite-native operations and safe dry-run diagnostics', () => {
    const plan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/Issue-1/A.png', folderId: 'folder-1', relativePath: 'Issue-1/A.png' },
        { id: 'file-2', path: '/jobs/input/Issue-1/B.psd', folderId: 'folder-1', relativePath: 'Issue-1/B.psd' },
        { id: 'file-3', path: '/jobs/input/loose/C.png' },
      ],
      folders: [{ id: 'folder-1', path: '/jobs/input/Issue-1', label: 'Issue 1' }],
      macroIds: ['macro-cleanup', 'macro-missing'],
      actionIds: ['flattenVisible'],
      availableMacroIds: ['macro-cleanup'],
      availableActionIds: ['flattenVisible'],
      output: {
        folderPath: '/jobs/output',
        format: 'png',
        preserveFolderStructure: true,
      },
    });

    expect(plan.fileAccess.capabilities).toEqual({
      directFileListInput: true,
      folderInput: true,
      folderOutput: true,
      perFileOutputDescriptors: true,
      writesDuringDryRun: false,
    });
    expect(plan.variableFillPlan).toMatchObject({
      state: 'available-for-review',
      bindingReadiness: 'ready-for-explicit-review',
      supportsOutputNamingBindings: true,
      supportsMacroPlaceholderBindings: true,
      supportsArbitraryJsExpressions: false,
    });
    expect(plan.actionMacroHandoff).toMatchObject({
      automationSurface: {
        workspaceId: 'image-automation',
        surface: 'folder-list-batch',
        separateFromMainFlow: true,
      },
      callableOperations: [
        {
          kind: 'macro',
          id: 'macro-cleanup',
          source: 'saved-macro',
          callable: true,
        },
        {
          kind: 'quick-action',
          id: 'flattenVisible',
          source: 'suite-native-quick-action',
          callable: true,
        },
        {
          kind: 'macro',
          id: 'macro-missing',
          source: 'saved-macro',
          callable: false,
          reason: 'missing-from-registry',
        },
      ],
    });
    expect(plan.nativeExecutionState.unsupportedArbitraryJsState).toEqual({
      supported: false,
      reason: 'Only suite-native macro and quick-action ids are callable; arbitrary JavaScript state is unsupported.',
    });
    expect(plan.progressEvidence.dryRunDiagnostics).toEqual({
      scope: 'multiple-documents',
      safe: true,
      canMutateDocuments: false,
      documentCount: 3,
      plannedDocumentCount: 3,
      skippedDocumentCount: 0,
      sampleInputPaths: [
        '/jobs/input/Issue-1/A.png',
        '/jobs/input/Issue-1/B.psd',
        '/jobs/input/loose/C.png',
      ],
    });
  });

  it('exposes stable queue ids, per-item diagnostics, and dry-run execution log entries', () => {
    const plan = buildImageBatchPlan({
      files: [
        { id: 'file-1', path: '/jobs/input/A.png' },
        { id: 'file-2', path: '/jobs/input/B.psd' },
        { id: 'raw-1', path: '/jobs/input/C.CR3' },
      ],
      macroIds: ['macro-cleanup'],
      actionIds: ['flattenVisible', 'missingAction'],
      availableMacroIds: ['macro-cleanup'],
      availableActionIds: ['flattenVisible'],
      output: {
        folderPath: '/jobs/output',
        format: 'png',
      },
    });

    expect(plan.queueIdentity).toEqual({
      queueId: 'image-batch-queue:file-1+file-2+raw-1:macro-cleanup+flattenVisible:1-unavailable',
      actionSetId: 'image-batch-action-set:macro-cleanup:flattenVisible:missingAction',
      workspaceId: 'image-automation',
      signature: 'image-batch-queue-identity:v1:{"fileIds":["file-1","file-2","raw-1"],"macroIds":["macro-cleanup"],"actionIds":["flattenVisible"],"missingMacroIds":[],"missingActionIds":["missingAction"],"workspaceId":"image-automation"}',
    });
    expect(plan.items.map((item) => item.queueDiagnostics)).toEqual([
      {
        queueItemId: 'image-batch-item:file-1:001',
        queueId: plan.queueIdentity.queueId,
        fileId: 'file-1',
        inputStatus: 'accepted',
        dryRunStatus: 'planned-not-executed',
        plannedOperationIds: ['macro-cleanup', 'flattenVisible'],
        unavailableCommandIds: ['missingAction'],
        outputPath: '/jobs/output/A-macro-cleanup+flattenVisible.png',
        signature: 'image-batch-item-diagnostics:v1:{"queueId":"image-batch-queue:file-1+file-2+raw-1:macro-cleanup+flattenVisible:1-unavailable","queueItemId":"image-batch-item:file-1:001","fileId":"file-1","inputStatus":"accepted","dryRunStatus":"planned-not-executed","plannedOperationIds":["macro-cleanup","flattenVisible"],"unavailableCommandIds":["missingAction"],"outputPath":"/jobs/output/A-macro-cleanup+flattenVisible.png"}',
      },
      {
        queueItemId: 'image-batch-item:file-2:002',
        queueId: plan.queueIdentity.queueId,
        fileId: 'file-2',
        inputStatus: 'accepted',
        dryRunStatus: 'planned-not-executed',
        plannedOperationIds: ['macro-cleanup', 'flattenVisible'],
        unavailableCommandIds: ['missingAction'],
        outputPath: '/jobs/output/B-macro-cleanup+flattenVisible.png',
        signature: 'image-batch-item-diagnostics:v1:{"queueId":"image-batch-queue:file-1+file-2+raw-1:macro-cleanup+flattenVisible:1-unavailable","queueItemId":"image-batch-item:file-2:002","fileId":"file-2","inputStatus":"accepted","dryRunStatus":"planned-not-executed","plannedOperationIds":["macro-cleanup","flattenVisible"],"unavailableCommandIds":["missingAction"],"outputPath":"/jobs/output/B-macro-cleanup+flattenVisible.png"}',
      },
    ]);
    expect(plan.skipped[0].queueDiagnostics).toEqual({
      queueItemId: 'image-batch-item:raw-1:skipped',
      queueId: plan.queueIdentity.queueId,
      fileId: 'raw-1',
      inputStatus: 'skipped',
      dryRunStatus: 'skipped-before-execution',
      plannedOperationIds: [],
      unavailableCommandIds: ['missingAction'],
      skipReason: 'unsupported-extension',
      signature: 'image-batch-item-diagnostics:v1:{"queueId":"image-batch-queue:file-1+file-2+raw-1:macro-cleanup+flattenVisible:1-unavailable","queueItemId":"image-batch-item:raw-1:skipped","fileId":"raw-1","inputStatus":"skipped","dryRunStatus":"skipped-before-execution","plannedOperationIds":[],"unavailableCommandIds":["missingAction"],"skipReason":"unsupported-extension"}',
    });
    expect(plan.executionLog).toEqual({
      runId: 'image-batch-run:dry-run:file-1+file-2+raw-1:2-planned:1-skipped',
      queueId: plan.queueIdentity.queueId,
      mode: 'dry-run',
      status: 'planned',
      stepCount: 6,
      entries: [
        {
          id: 'image-batch-log:001:file-1:macro-cleanup',
          queueItemId: 'image-batch-item:file-1:001',
          fileId: 'file-1',
          operation: { kind: 'macro', id: 'macro-cleanup' },
          status: 'dry-run',
          executed: false,
          message: 'Planned macro macro-cleanup for /jobs/input/A.png.',
        },
        {
          id: 'image-batch-log:002:file-1:flattenVisible',
          queueItemId: 'image-batch-item:file-1:001',
          fileId: 'file-1',
          operation: { kind: 'quick-action', id: 'flattenVisible' },
          status: 'dry-run',
          executed: false,
          message: 'Planned quick-action flattenVisible for /jobs/input/A.png.',
        },
        {
          id: 'image-batch-log:003:file-1:missingAction',
          queueItemId: 'image-batch-item:file-1:001',
          fileId: 'file-1',
          operation: { kind: 'quick-action', id: 'missingAction' },
          status: 'unavailable',
          executed: false,
          message: 'Skipped unavailable quick-action missingAction for /jobs/input/A.png.',
        },
        {
          id: 'image-batch-log:004:file-2:macro-cleanup',
          queueItemId: 'image-batch-item:file-2:002',
          fileId: 'file-2',
          operation: { kind: 'macro', id: 'macro-cleanup' },
          status: 'dry-run',
          executed: false,
          message: 'Planned macro macro-cleanup for /jobs/input/B.psd.',
        },
        {
          id: 'image-batch-log:005:file-2:flattenVisible',
          queueItemId: 'image-batch-item:file-2:002',
          fileId: 'file-2',
          operation: { kind: 'quick-action', id: 'flattenVisible' },
          status: 'dry-run',
          executed: false,
          message: 'Planned quick-action flattenVisible for /jobs/input/B.psd.',
        },
        {
          id: 'image-batch-log:006:file-2:missingAction',
          queueItemId: 'image-batch-item:file-2:002',
          fileId: 'file-2',
          operation: { kind: 'quick-action', id: 'missingAction' },
          status: 'unavailable',
          executed: false,
          message: 'Skipped unavailable quick-action missingAction for /jobs/input/B.psd.',
        },
      ],
      unsupportedExecution: {
        nativeFilesystemExecution: false,
        unattendedBackgroundExecution: false,
        arbitraryPluginCommands: false,
        fullPhotoshopActions: false,
      },
      signature: 'image-batch-execution-log:v1:{"runId":"image-batch-run:dry-run:file-1+file-2+raw-1:2-planned:1-skipped","queueId":"image-batch-queue:file-1+file-2+raw-1:macro-cleanup+flattenVisible:1-unavailable","entryIds":["image-batch-log:001:file-1:macro-cleanup","image-batch-log:002:file-1:flattenVisible","image-batch-log:003:file-1:missingAction","image-batch-log:004:file-2:macro-cleanup","image-batch-log:005:file-2:flattenVisible","image-batch-log:006:file-2:missingAction"],"mode":"dry-run","status":"planned"}',
    });
  });
});
