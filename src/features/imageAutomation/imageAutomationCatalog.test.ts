import { describe, expect, it } from 'vitest';
import { FLOW_NODE_TYPES } from '../../types/flow';
import {
  IMAGE_AUTOMATION_NODE_CATALOG_CATEGORIES,
  IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES,
  getImageAutomationCapabilitiesForNode,
  getImageAutomationNodeEntriesForCategory,
  getImageAutomationNodeEntriesForRole,
  getImageAutomationNodeEntry,
  getImageAutomationWorkspaceDescriptor,
} from './imageAutomationCatalog';

describe('imageAutomationCatalog', () => {
  it('defines a bounded Image Automation node catalog for batch image-editor automation', () => {
    expect(IMAGE_AUTOMATION_NODE_CATALOG_CATEGORIES.map((category) => category.id)).toEqual([
      'file-system',
      'batch',
      'image-operations',
      'planning',
      'outputs',
    ]);

    expect(IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.map((entry) => entry.type)).toEqual([
      'directoryInput',
      'directoryGlobInput',
      'imageBatchList',
      'extractImageMetadata',
      'openImage',
      'resizeCanvas',
      'applyAdjustment',
      'applyImageMacro',
      'aiVariableFillPlan',
      'saveOutput',
      'packageOutput',
    ]);
  });

  it('keeps Image Automation types disjoint from main Flow types', () => {
    const flowTypes = new Set<string>(FLOW_NODE_TYPES);
    for (const entry of IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES) {
      expect(flowTypes.has(entry.type)).toBe(false);
    }
  });

  it('tracks bounded workspace theme and background metadata', () => {
    expect(getImageAutomationWorkspaceDescriptor()).toEqual({
      workspaceId: 'image-automation',
      label: 'Image Automation',
      philosophy: 'batch-image-workspace',
      flowRelationship: 'separate-from-main-flow',
      storageKey: 'signal-loom-image-automation-flow',
      nodeRegistry: 'bounded-image-automation-catalog',
      theme: {
        themeId: 'image-automation-emerald-grid',
        cssClass: 'bg-[#031613]',
        dotColor: 'rgba(52,211,153,0.14)',
        dotGapPx: 28,
        dotSizePx: 1.4,
        pattern: 'radial-grid',
        dataAttribute: {
          workspace: 'data-image-automation-workspace',
          theme: 'data-image-automation-theme',
          canvas: 'data-image-automation-canvas',
        },
      },
      nativeExecution: {
        supported: false,
        state: 'unsupported-planning-only',
        reason:
          'Image Automation currently produces typed plans and handoff descriptors; native unattended execution is not wired.',
        filesystemStates: [
          {
            operation: 'read-directory',
            supported: false,
            state: 'requires-user-confirmed-directory-handle',
            reason: 'Directory reads are planned from user-selected handles and are not crawled by the catalog.',
          },
          {
            operation: 'write-image-file',
            supported: false,
            state: 'unsupported-native-adapter-missing',
            reason: 'Image file writes are output descriptors until a browser or native filesystem adapter runs them.',
          },
          {
            operation: 'write-output-directory',
            supported: false,
            state: 'unsupported-native-adapter-missing',
            reason: 'Package/output directory creation is not performed by the Image Automation catalog.',
          },
        ],
        signature: 'image-automation-native-filesystem:v1:{"supported":false,"states":["read-directory:requires-user-confirmed-directory-handle","write-image-file:unsupported-native-adapter-missing","write-output-directory:unsupported-native-adapter-missing"]}',
      },
      dashboardSignatures: {
        workspace: 'image-automation-workspace:v1:{"workspaceId":"image-automation","flowRelationship":"separate-from-main-flow","nodeRegistry":"bounded-image-automation-catalog"}',
        nodeCatalog: 'image-automation-node-catalog:v1:{"types":["directoryInput","directoryGlobInput","imageBatchList","extractImageMetadata","openImage","resizeCanvas","applyAdjustment","applyImageMacro","aiVariableFillPlan","saveOutput","packageOutput"],"scope":"image-editor"}',
        nativeFilesystem: 'image-automation-native-filesystem:v1:{"supported":false,"states":["read-directory:requires-user-confirmed-directory-handle","write-image-file:unsupported-native-adapter-missing","write-output-directory:unsupported-native-adapter-missing"]}',
        checklist: 'image-automation-dashboard-checklist:v1:{"workspace":"image-automation-workspace:v1:{\\"workspaceId\\":\\"image-automation\\",\\"flowRelationship\\":\\"separate-from-main-flow\\",\\"nodeRegistry\\":\\"bounded-image-automation-catalog\\"}","nodeCatalog":"image-automation-node-catalog:v1:{\\"types\\":[\\"directoryInput\\",\\"directoryGlobInput\\",\\"imageBatchList\\",\\"extractImageMetadata\\",\\"openImage\\",\\"resizeCanvas\\",\\"applyAdjustment\\",\\"applyImageMacro\\",\\"aiVariableFillPlan\\",\\"saveOutput\\",\\"packageOutput\\"],\\"scope\\":\\"image-editor\\"}","nativeFilesystem":"image-automation-native-filesystem:v1:{\\"supported\\":false,\\"states\\":[\\"read-directory:requires-user-confirmed-directory-handle\\",\\"write-image-file:unsupported-native-adapter-missing\\",\\"write-output-directory:unsupported-native-adapter-missing\\"]}"}',
      },
      primaryPayloads: [
        'directory',
        'directory-glob',
        'image-batch',
        'image-metadata',
        'open-image',
        'batch-item',
        'ai-variable-plan',
        'save-summary',
        'package-summary',
      ],
    });
  });

  it('contains read/write directory, batch list/map, open image, apply-image-action, and AI planner nodes', () => {
    expect(getImageAutomationNodeEntriesForCategory('file-system').map((entry) => entry.type)).toEqual([
      'directoryInput',
      'directoryGlobInput',
    ]);
    expect(getImageAutomationNodeEntriesForCategory('batch').map((entry) => entry.type)).toEqual([
      'imageBatchList',
      'extractImageMetadata',
    ]);
    expect(getImageAutomationNodeEntriesForCategory('image-operations').map((entry) => entry.type)).toEqual([
      'openImage',
      'resizeCanvas',
      'applyAdjustment',
      'applyImageMacro',
    ]);
    expect(getImageAutomationNodeEntriesForCategory('planning').map((entry) => entry.type)).toEqual([
      'aiVariableFillPlan',
    ]);
    expect(getImageAutomationNodeEntriesForCategory('outputs').map((entry) => entry.type)).toEqual([
      'saveOutput',
      'packageOutput',
    ]);

    expect(getImageAutomationNodeEntriesForRole('read-directory').map((entry) => entry.type)).toContain('directoryInput');
    expect(getImageAutomationNodeEntriesForRole('batch-list').map((entry) => entry.type)).toContain('imageBatchList');
    expect(getImageAutomationNodeEntriesForRole('batch-map').map((entry) => entry.type)).toContain('extractImageMetadata');
    expect(getImageAutomationNodeEntriesForRole('open-image').map((entry) => entry.type)).toContain('openImage');
    expect(getImageAutomationNodeEntriesForRole('apply-image-action').map((entry) => entry.type)).toContain(
      'applyImageMacro',
    );
    expect(getImageAutomationNodeEntriesForRole('save-image').map((entry) => entry.type)).toContain('saveOutput');
    expect(getImageAutomationNodeEntriesForRole('write-directory').map((entry) => entry.type)).toContain('packageOutput');
    expect(getImageAutomationNodeEntriesForRole('plan-ai-variables').map((entry) => entry.type)).toContain(
      'aiVariableFillPlan',
    );
  });

  it('attaches filesystem/planner capability descriptors and keeps automation scope as image workspace', () => {
    const directoryInput = getImageAutomationNodeEntry('directoryInput');
    const directoryGlobInput = getImageAutomationNodeEntry('directoryGlobInput');
    const saveOutput = getImageAutomationNodeEntry('saveOutput');
    const packageOutput = getImageAutomationNodeEntry('packageOutput');

    [directoryInput, directoryGlobInput, saveOutput, packageOutput].forEach((node) => {
      expect(node.automationWorkspaceId).toBe('image-automation');
      expect(node.automationScope).toBe('image-editor');
      expect(node.capabilities.length).toBeGreaterThan(0);
      expect(node.capabilities.every((capability) => capability.executionMode === 'descriptor-only')).toBe(true);
      expect(node.signature).toContain(`image-automation-node:v1:{"type":"${node.type}"`);
    });

    expect(getImageAutomationCapabilitiesForNode('directoryInput')).toContainEqual(
      expect.objectContaining({ kind: 'filesystem', action: 'read', target: 'directory' }),
    );
    expect(getImageAutomationCapabilitiesForNode('packageOutput')).toContainEqual(
      expect.objectContaining({ kind: 'filesystem', action: 'write', target: 'directory' }),
    );
    expect(getImageAutomationCapabilitiesForNode('saveOutput')).toContainEqual(
      expect.objectContaining({ kind: 'filesystem', action: 'write', target: 'image-file' }),
    );
    expect(getImageAutomationCapabilitiesForNode('openImage')).toContainEqual(
      expect.objectContaining({ kind: 'planner', action: 'open-image' }),
    );
    expect(getImageAutomationCapabilitiesForNode('applyImageMacro')).toContainEqual(
      expect.objectContaining({ kind: 'planner', action: 'apply-image-action' }),
    );
  });

  it('keeps bounded node defaults and payload wiring typed for batch/editor flow', () => {
    const directoryInput = getImageAutomationNodeEntry('directoryInput');
    const directoryGlobInput = getImageAutomationNodeEntry('directoryGlobInput');
    const imageBatchList = getImageAutomationNodeEntry('imageBatchList');
    const extractMetadata = getImageAutomationNodeEntry('extractImageMetadata');
    const openImage = getImageAutomationNodeEntry('openImage');
    const resizeCanvas = getImageAutomationNodeEntry('resizeCanvas');
    const applyAdjustment = getImageAutomationNodeEntry('applyAdjustment');
    const applyImageMacro = getImageAutomationNodeEntry('applyImageMacro');
    const aiVariableFillPlan = getImageAutomationNodeEntry('aiVariableFillPlan');
    const saveOutput = getImageAutomationNodeEntry('saveOutput');
    const packageOutput = getImageAutomationNodeEntry('packageOutput');

    expect(directoryInput.initialData).toMatchObject({
      automationScope: 'image-editor',
      operation: 'read-directory',
      config: {
        includeSubfolders: false,
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'],
      },
    });
    expect(directoryGlobInput.initialData).toMatchObject({
      automationScope: 'image-editor',
      operation: 'read-directory-glob',
      config: {
        directoryPath: '',
        globPattern: '**/*.{png,jpg,jpeg,webp,tif,tiff}',
        includeSubfolders: true,
        excludeGlobs: ['**/.DS_Store', '**/node_modules/**'],
      },
    });
    expect(imageBatchList.initialData.operation).toBe('batch-list');
    expect(extractMetadata.initialData.operation).toBe('batch-map');
    expect(openImage.initialData).toMatchObject({
      automationScope: 'image-editor',
      operation: 'open-image',
      config: {
        readMode: 'all',
        preloadPixels: false,
      },
    });

    expect(openImage.outputs).toEqual([
      expect.objectContaining({ id: 'openImageBatch', payload: 'open-image', required: true }),
    ]);
    expect(resizeCanvas.initialData.operation).toBe('resize');
    expect(applyAdjustment.initialData.operation).toBe('apply-adjustment');
    expect(applyImageMacro.initialData.operation).toBe('apply-image-action');
    expect(aiVariableFillPlan.initialData.operation).toBe('plan-ai-variables');
    expect(saveOutput.initialData.operation).toBe('save-image');
    expect(packageOutput.initialData.operation).toBe('write-directory');

    expect(saveOutput.inputs).toEqual([
      expect.objectContaining({ id: 'imageBatch', payload: 'image-batch', required: true }),
    ]);
    expect(saveOutput.outputs).toEqual([
      expect.objectContaining({ id: 'saveSummary', payload: 'save-summary', required: true }),
    ]);
    expect(packageOutput.outputs).toEqual([
      expect.objectContaining({ id: 'packageSummary', payload: 'package-summary', required: true }),
    ]);
    expect(saveOutput.signature).toBe(
      'image-automation-node:v1:{"type":"saveOutput","workspaceId":"image-automation","scope":"image-editor","role":"save-image","categoryId":"outputs","inputs":["imageBatch:image-batch:required"],"outputs":["saveSummary:save-summary:required"],"capabilities":["filesystem:write:image-file"]}',
    );

    expect(packageOutput.initialData.config).toMatchObject({
      includeOriginals: false,
      includeManifest: true,
      includeRunLog: true,
      overwrite: false,
    });

    for (const entry of [
      directoryInput,
      directoryGlobInput,
      imageBatchList,
      extractMetadata,
      openImage,
      resizeCanvas,
      applyAdjustment,
      applyImageMacro,
      aiVariableFillPlan,
      saveOutput,
      packageOutput,
    ]) {
      expect(entry.safetyWarnings.length).toBeGreaterThan(0);
      expect(entry.initialData.safetyWarnings).toEqual(entry.safetyWarnings);
      expect([...entry.inputs, ...entry.outputs].every((port) => port.id && port.label && port.payload)).toBe(true);
    }
  });

  it('keeps the readable batch editor catalog ordered left-to-right with stable flow columns', () => {
    expect(IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.map((entry) => [entry.type, entry.flowColumn])).toEqual([
      ['directoryInput', 0],
      ['directoryGlobInput', 0],
      ['imageBatchList', 1],
      ['extractImageMetadata', 2],
      ['openImage', 3],
      ['resizeCanvas', 4],
      ['applyAdjustment', 5],
      ['applyImageMacro', 6],
      ['aiVariableFillPlan', 7],
      ['saveOutput', 8],
      ['packageOutput', 9],
    ]);

    const flowColumns = IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.map((entry) => entry.flowColumn);
    expect(flowColumns).toEqual([...flowColumns].sort((a, b) => a - b));
  });
});
