import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import {
  IMAGE_DOCUMENT_SAVE_FORMATS,
  describeImageDocumentSaveWorkflow,
  describeStandaloneQuickEditSaveOpenReadiness,
  getImageDocumentSaveFormat,
  getVisibleImageSaveFormats,
  isVisibleImageSaveFormat,
} from './ImageDocumentSave';
import { IMAGE_PSD_MIME_TYPE } from './ImagePsdInterop';
import { IMAGE_XCF_MIME_TYPE } from './ImageXcfInterop';

describe('ImageDocumentSave', () => {
  it('offers standalone image-file saves and workflow-safe visible handoff formats separately', () => {
    expect(IMAGE_DOCUMENT_SAVE_FORMATS.map((format) => format.extension)).toEqual([
      'png',
      'jpg',
      'webp',
      'avif',
      'bmp',
      'gif',
      'tif',
      'exr',
      'svg',
      'psd',
      'xcf',
    ]);

    expect(getVisibleImageSaveFormats().map((format) => format.extension)).toEqual([
      'png',
      'jpg',
      'webp',
      'avif',
      'bmp',
      'gif',
      'tif',
      'exr',
      'svg',
    ]);
    expect(isVisibleImageSaveFormat('image/bmp')).toBe(true);
    expect(isVisibleImageSaveFormat(IMAGE_PSD_MIME_TYPE)).toBe(false);
    expect(isVisibleImageSaveFormat(IMAGE_XCF_MIME_TYPE)).toBe(false);
  });

  it('normalizes unknown save formats to PNG while preserving layered formats', () => {
    expect(getImageDocumentSaveFormat('image/bmp')).toMatchObject({ extension: 'bmp' });
    expect(getImageDocumentSaveFormat(IMAGE_PSD_MIME_TYPE)).toMatchObject({ extension: 'psd' });
    expect(getImageDocumentSaveFormat(IMAGE_XCF_MIME_TYPE)).toMatchObject({ extension: 'xcf' });
    expect(getImageDocumentSaveFormat('not/a-format')).toMatchObject({ extension: 'png' });
  });

  it('describes quick-edit save-over workflows with destructive overwrite and flattened export warnings', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      sourceBinItemId: 'source-cover',
      layers: [
        layerFixture({ id: 'base', name: 'Base' }),
        layerFixture({ id: 'paint', name: 'Paint' }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: true,
      sourceItemExists: true,
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'quick-edit',
      destination: 'source-bin',
      sourceBinItemId: 'source-cover',
      overwritesSource: true,
      preservesLayers: false,
      flattenedExport: true,
      nativeRoundtrip: 'none',
      format: { extension: 'png', kind: 'visible' },
      sourceState: {
        kind: 'document-source',
        documentSourceId: 'source-cover',
        sourceItemExists: true,
        layerSourceIds: [],
        missingSourceIds: [],
      },
      savePolicy: {
        destructiveSave: 'overwrite-current-source',
        canOverwriteSource: true,
        exportOnly: false,
        writesSourceLibrary: true,
      },
      preview: {
        documentId: 'doc-1',
        title: 'Document',
        width: 100,
        height: 80,
        layerCount: 2,
        dirty: true,
        formatExtension: 'png',
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'destructive-overwrite',
      'flattened-export',
    ]);
    expect(descriptor.preview.signature).toBe(descriptor.previewSignature);
    expect(descriptor.previewSignature).toContain('"documentId":"doc-1"');
    expect(descriptor.previewSignature).toContain('"warningCodes":["destructive-overwrite","flattened-export"]');
  });

  it('describes source-linked layered downloads with missing link and unsupported native roundtrip warnings', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      layers: [
        layerFixture({
          id: 'smart',
          name: 'Missing smart source',
          metadata: {
            smartLinkedSourceId: 'missing-source',
            sourceLink: {
              id: 'missing-source',
              label: 'Missing source',
              status: 'missing',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'download',
      mimeType: IMAGE_PSD_MIME_TYPE,
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'source-linked',
      destination: 'download',
      sourceBinItemId: undefined,
      overwritesSource: false,
      preservesLayers: true,
      flattenedExport: false,
      nativeRoundtrip: 'metadata-only',
      format: { extension: 'psd', kind: 'layered' },
      sourceState: {
        kind: 'layer-sources',
        documentSourceId: null,
        sourceItemExists: null,
        layerSourceIds: ['missing-source'],
        missingSourceIds: ['missing-source'],
      },
      nativeRoundtripCaveats: [
        {
          code: 'signal-loom-metadata-only',
          formatExtension: 'psd',
        },
      ],
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'missing-source-link',
      'unsupported-native-roundtrip',
    ]);
  });

  it('describes source-bin export-only copies with a non-destructive save policy warning', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      title: 'Standalone paint',
      layers: [layerFixture({ id: 'paint', name: 'Paint' })],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: false,
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'export-only',
      destination: 'source-bin',
      overwritesSource: false,
      sourceState: {
        kind: 'standalone',
        documentSourceId: null,
        sourceItemExists: null,
        layerSourceIds: [],
        missingSourceIds: [],
      },
      savePolicy: {
        destructiveSave: 'copy-only',
        canOverwriteSource: false,
        exportOnly: true,
        writesSourceLibrary: true,
      },
      preview: {
        documentId: 'doc-1',
        title: 'Standalone paint',
        width: 100,
        height: 80,
        layerCount: 1,
        dirty: true,
        formatExtension: 'png',
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(['export-only-copy']);
    expect(descriptor.previewSignature).toBe(descriptor.preview.signature);
    expect(descriptor.previewSignature).toContain('"destructiveSave":"copy-only"');
  });

  it('describes export-only downloads without source-library side effects', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      layers: [layerFixture()],
    }), {
      destination: 'download',
      mimeType: 'image/png',
    });

    expect(descriptor).toMatchObject({
      workflowKind: 'export-only',
      destination: 'download',
      sourceBinItemId: undefined,
      overwritesSource: false,
      preservesLayers: false,
      flattenedExport: false,
      nativeRoundtrip: 'none',
      format: { extension: 'png', kind: 'visible' },
      warnings: [],
    });
  });

  it('summarizes standalone quick-edit save/open readiness with destructive overwrite and flattened preview signatures', () => {
    const readiness = describeStandaloneQuickEditSaveOpenReadiness(documentFixture({
      sourceBinItemId: 'source-cover',
      layers: [
        layerFixture({ id: 'base', name: 'Base' }),
        layerFixture({ id: 'paint', name: 'Paint', opacity: 0.75 }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: true,
      sourceItemExists: true,
      osIdentity: {
        platform: 'linux',
        signedPackage: false,
        appId: 'dev.signal-loom',
      },
    });

    expect(readiness).toMatchObject({
      descriptorId: 'standalone-quick-edit-save-open-readiness:v1',
      ready: true,
      documentState: {
        documentId: 'doc-1',
        title: 'Document',
        sourceBinItemId: 'source-cover',
        workflowKind: 'quick-edit',
        mode: 'source-linked',
        layerCount: 2,
        dirty: true,
      },
      saveOpen: {
        destination: 'source-bin',
        formatExtension: 'png',
        destructivePolicy: 'overwrite-current-source',
        overwritesSource: true,
        flattenedExport: true,
        preservesLayers: false,
        nativeRoundtrip: 'none',
        canReopenAsEditableDocument: false,
        canReopenLinkedSource: true,
      },
      osIdentity: {
        platform: 'linux',
        appId: 'dev.signal-loom',
        signedPackage: false,
        caveats: [
          'Unsigned desktop builds may not preserve OS-level file association, open-with, or save permission identity across machines.',
        ],
      },
      sourceLinks: {
        documentSourceId: 'source-cover',
        sourceItemExists: true,
        layerSourceIds: [],
        missingSourceIds: [],
      },
      blockers: [],
    });
    expect(readiness.warningCodes).toEqual(['destructive-overwrite', 'flattened-export']);
    expect(readiness.previewSignature).toBe(readiness.workflow.previewSignature);
    expect(readiness.signature).toContain('"descriptorId":"standalone-quick-edit-save-open-readiness:v1"');
    expect(readiness.signature).toContain('"previewSignature":"image-document-save:v1:');
  });

  it('reports export-only, missing source, native roundtrip, and OS signing blockers deterministically', () => {
    const readiness = describeStandaloneQuickEditSaveOpenReadiness(documentFixture({
      sourceBinItemId: 'missing-document-source',
      layers: [
        layerFixture({
          id: 'text',
          name: 'Title',
          type: 'text',
          metadata: {
            sourceLink: {
              id: 'missing-layer-source',
              label: 'Missing layer source',
              status: 'missing',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: IMAGE_XCF_MIME_TYPE,
      overwriteSource: true,
      sourceItemExists: false,
      osIdentity: {
        platform: 'darwin',
        signedPackage: false,
        appId: null,
      },
    });

    expect(readiness).toMatchObject({
      ready: false,
      documentState: {
        workflowKind: 'quick-edit',
        mode: 'source-linked',
      },
      saveOpen: {
        destructivePolicy: 'copy-only',
        overwritesSource: false,
        flattenedExport: false,
        preservesLayers: true,
        nativeRoundtrip: 'unsupported',
        canReopenAsEditableDocument: false,
        canReopenLinkedSource: false,
      },
      sourceLinks: {
        documentSourceId: 'missing-document-source',
        sourceItemExists: false,
        layerSourceIds: ['missing-layer-source'],
        missingSourceIds: ['missing-document-source', 'missing-layer-source'],
      },
      osIdentity: {
        platform: 'darwin',
        signedPackage: false,
        appId: null,
      },
    });
    expect(readiness.warningCodes).toEqual([
      'missing-source-link',
      'unsupported-native-roundtrip',
    ]);
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'missing-source-link',
      'native-roundtrip-unsupported',
      'os-identity-unsigned',
      'os-identity-missing-app-id',
    ]);
    expect(readiness.nativeRoundtripUnsupported).toEqual({
      unsupported: true,
      state: 'unsupported',
      caveatCodes: ['native-layer-roundtrip-unsupported'],
    });
  });

  it('describes flattened workfile packaging, source-linked originals, suite handoff, and native app caveats deterministically', () => {
    const readiness = describeStandaloneQuickEditSaveOpenReadiness(documentFixture({
      sourceBinItemId: 'cover-source',
      layers: [
        layerFixture({ id: 'base', name: 'Base' }),
        layerFixture({
          id: 'linked',
          name: 'Linked original',
          opacity: 0.8,
          metadata: {
            smartLinkedSourceId: 'linked-original',
            sourceLink: {
              id: 'linked-original',
              label: 'Linked original',
              status: 'linked',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: true,
      sourceItemExists: true,
      osIdentity: {
        platform: 'win32',
        signedPackage: false,
        appId: 'dev.signal-loom',
      },
    });

    expect(readiness.saveOpen).toMatchObject({
      destructivePolicy: 'overwrite-current-source',
      flattenedExport: true,
      editableWorkfileState: 'flattened-export-only',
    });
    expect(readiness.workflow.sourceLinkedOriginals).toEqual({
      sourceIds: ['cover-source', 'linked-original'],
      missingSourceIds: [],
      preservedInSavedOutput: false,
      requiresPackageOriginals: true,
      signature: 'image-document-save-source-links:v1|ids=cover-source,linked-original|missing=none|preserved=false|packageOriginals=true',
    });
    expect(readiness.workflow.workfilePackage).toEqual({
      kind: 'flattened-export-package',
      destination: 'source-bin',
      formatExtension: 'png',
      editableWorkfileState: 'flattened-export-only',
      preservesLayers: false,
      includesSourceLibraryLink: true,
      requiresSourceLinkedOriginalPackaging: true,
      warnings: ['destructive-overwrite', 'flattened-export'],
      signature: 'image-document-save-workfile-package:v1|kind=flattened-export-package|destination=source-bin|format=png|editable=flattened-export-only|preservesLayers=false|includesSourceLibraryLink=true|requiresOriginals=true|warnings=destructive-overwrite,flattened-export',
    });
    expect(readiness.workflow.suiteHandoff).toEqual({
      ready: true,
      destination: 'source-bin',
      workfilePackageKind: 'flattened-export-package',
      preservesEditability: false,
      requiresSourceLinkedOriginalPackaging: true,
      caveats: [
        'Flattened exports package the visible composite only; keep the Image workfile and linked originals beside the Source Library derivative for suite handoff.',
      ],
      signature: 'image-document-save-suite-handoff:v1|ready=true|destination=source-bin|package=flattened-export-package|preservesEditability=false|requiresOriginals=true|caveats=flattened-export-needs-workfile-package',
    });
    expect(readiness.nativeApp).toMatchObject({
      workspace: 'image',
      status: 'ready',
      unsupportedStandaloneExecutable: true,
      suiteHandoffMode: 'shared-binary-deep-link',
      packageTargets: ['macos', 'windows', 'linux'],
      packageCaveats: [
        'Standalone Image handoff stays inside the shared Sloom Studio desktop package; separate signed single-workspace executables are not produced.',
      ],
    });
    expect(readiness.nativeApp.signature).toBe(
      'native-standalone-entry:v2|image|view:image|signal-loom://workspace/image|shared-binary-window|suite-handoff=shared-binary-deep-link|targets=macos,windows,linux|separate-exe=false',
    );
    expect(readiness.signature).toContain('"editableWorkfileState":"flattened-export-only"');
    expect(readiness.signature).toContain('"workfilePackageKind":"flattened-export-package"');
  });

  it('adds concrete policy checks for destructive quick-edit saves and stable suite package signatures', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      sourceBinItemId: 'cover-source',
      layers: [
        layerFixture({ id: 'base', name: 'Base' }),
        layerFixture({
          id: 'linked',
          name: 'Linked original',
          metadata: {
            sourceLink: {
              id: 'linked-original',
              label: 'Linked original',
              status: 'linked',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: true,
      sourceItemExists: true,
    });

    expect(descriptor.policyChecks.destructiveSave).toEqual({
      kind: 'quick-edit-destructive-save-policy',
      status: 'overwrites-current-source',
      sourceBinItemId: 'cover-source',
      destructiveSave: 'overwrite-current-source',
      overwritesSource: true,
      canOverwriteSource: true,
      warningCodes: ['destructive-overwrite'],
      blockerCodes: [],
      signature: 'image-document-save-destructive-policy:v1|workflow=quick-edit|source=cover-source|policy=overwrite-current-source|overwrites=true|canOverwrite=true|warnings=destructive-overwrite|blockers=none',
    });
    expect(descriptor.policyChecks.exportOnlyCopy).toMatchObject({
      kind: 'export-only-copy-warning',
      status: 'not-applicable',
      warningCodes: [],
    });
    expect(descriptor.policyChecks.nativeRoundtrip).toMatchObject({
      kind: 'native-roundtrip-unsupported-state',
      status: 'supported',
      state: 'none',
      unsupported: false,
      warningCodes: [],
      caveatCodes: [],
      blockerCodes: [],
    });
    expect(descriptor.policyChecks.suitePackage).toEqual({
      kind: 'suite-package-descriptor',
      ready: true,
      packageKind: 'flattened-export-package',
      preservesEditability: false,
      requiresSourceLinkedOriginalPackaging: true,
      sourceIds: ['cover-source', 'linked-original'],
      missingSourceIds: [],
      workfilePackageSignature: descriptor.workfilePackage.signature,
      suiteHandoffSignature: descriptor.suiteHandoff.signature,
      signature: 'image-document-save-suite-package-check:v1|ready=true|package=flattened-export-package|preservesEditability=false|requiresOriginals=true|sources=cover-source,linked-original|missing=none',
    });
    expect(descriptor.policyChecks.signature).toContain('destructive=image-document-save-destructive-policy:v1');
    expect(descriptor.policyChecks.signature).toContain('suite=image-document-save-suite-package-check:v1');
  });

  it('exposes stable source document and save/export policy signatures without prose parsing', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      sourceBinItemId: 'cover-source',
      layers: [
        layerFixture({ id: 'base', name: 'Base' }),
        layerFixture({
          id: 'linked',
          name: 'Linked original',
          metadata: {
            sourceLink: {
              id: 'linked-original',
              label: 'Linked original',
              status: 'missing',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: 'image/png',
      overwriteSource: false,
      sourceItemExists: true,
    });

    expect(descriptor.sourceState).toMatchObject({
      kind: 'document-source',
      documentSourceId: 'cover-source',
      sourceItemExists: true,
      layerSourceIds: ['linked-original'],
      missingSourceIds: ['linked-original'],
      signature: 'image-document-save-source-state:v1|kind=document-source|document=cover-source|exists=true|layers=linked-original|missing=linked-original',
    });
    expect(descriptor.savePolicy).toMatchObject({
      destructiveSave: 'copy-unless-confirmed',
      canOverwriteSource: true,
      exportOnly: false,
      writesSourceLibrary: true,
      exportOnlyReason: null,
      destructiveOverwriteSafeguard: 'confirmation-required-before-overwrite',
      signature: 'image-document-save-export-policy:v1|workflow=quick-edit|destination=source-bin|destructive=copy-unless-confirmed|canOverwrite=true|exportOnly=false|writesSourceLibrary=true|safeguard=confirmation-required-before-overwrite|exportReason=none',
    });
    expect(descriptor.policyChecks.destructiveSave.status).toBe('blocked');
    expect(descriptor.policyChecks.suitePackage.ready).toBe(false);
  });

  it('checks export-only copies and unsupported native roundtrip states as blocked metadata', () => {
    const descriptor = describeImageDocumentSaveWorkflow(documentFixture({
      layers: [
        layerFixture({
          id: 'linked',
          name: 'Missing source',
          metadata: {
            sourceLink: {
              id: 'missing-source',
              label: 'Missing source',
              status: 'missing',
              relinkHistory: [],
            },
          },
        }),
      ],
    }), {
      destination: 'source-bin',
      mimeType: IMAGE_XCF_MIME_TYPE,
      overwriteSource: false,
    });

    expect(descriptor.policyChecks.exportOnlyCopy).toEqual({
      kind: 'export-only-copy-warning',
      status: 'not-applicable',
      destination: 'source-bin',
      writesSourceLibrary: true,
      warningCodes: [],
      signature: 'image-document-save-export-copy:v1|workflow=source-linked|destination=source-bin|writesSourceLibrary=true|warnings=none',
    });
    expect(descriptor.policyChecks.nativeRoundtrip).toEqual({
      kind: 'native-roundtrip-unsupported-state',
      status: 'unsupported',
      state: 'unsupported',
      unsupported: true,
      formatExtension: 'xcf',
      warningCodes: ['unsupported-native-roundtrip'],
      caveatCodes: ['native-layer-roundtrip-unsupported'],
      blockerCodes: ['native-roundtrip-unsupported'],
      signature: 'image-document-save-native-roundtrip-check:v1|state=unsupported|format=xcf|unsupported=true|warnings=unsupported-native-roundtrip|caveats=native-layer-roundtrip-unsupported|blockers=native-roundtrip-unsupported',
    });
    expect(descriptor.policyChecks.suitePackage).toMatchObject({
      ready: false,
      packageKind: 'unsupported-native-workfile-package',
      missingSourceIds: ['missing-source'],
    });
    expect(descriptor.policyChecks.suitePackage.signature).toBe(
      'image-document-save-suite-package-check:v1|ready=false|package=unsupported-native-workfile-package|preservesEditability=false|requiresOriginals=true|sources=missing-source|missing=missing-source',
    );
  });
});

function documentFixture(overrides: Partial<ImageDocument> = {}): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Document',
    width: 100,
    height: 80,
    layers: [layerFixture()],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: true,
    snapshots: [],
    ...overrides,
  };
}

function layerFixture(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}
