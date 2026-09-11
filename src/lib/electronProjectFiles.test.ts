import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_PROJECT_SCHEMA_VERSION, FLOW_NODE_TYPES } from './projectSchema';
import { sanitizeProjectDocument } from './projectValidation';
import { collectFlowVariableBindings, resolveFlowVariablesInText } from './flowVariables';
import { resolveLiveNodeResultAssetUrl } from '../components/Nodes/useLiveNodeResultAssetUrl';

interface ElectronProjectFilesModule {
  CURRENT_PROJECT_SCHEMA_VERSION: number;
  FLOW_NODE_TYPES: string[];
  SIGNAL_LOOM_PROJECT_EXTENSION: string;
  attachNativeScratchAssetsToProjectDocument: (
    document: Record<string, unknown>,
    scratchDirectoryPath: string,
    isUsableAsset?: (filePath: string) => boolean,
  ) => Record<string, unknown>;
  buildDataUrlAssetSignatureCandidates: (
    buffer: Buffer,
    fileName: string,
    fallbackMimeType?: string,
  ) => string[];
  buildMediaAssetSignaturePart: (url: string) => string;
  buildNativeAssetUrl: (filePath: string, assetId?: string) => string;
  buildLegacyNativeAssetUrl: (filePath: string) => string;
  decodeNativeAssetUrl: (url: string) => string;
  parseNativeAssetUrl: (url: string) => { type: 'file'; filePath: string } | { type: 'asset'; assetId: string };
  buildNativeScratchFileName: (item: Record<string, unknown>) => string;
  buildProjectOverwriteBackupPath: (filePath: string, now?: Date) => string;
  buildProjectScratchDirectoryCandidates: (filePath: string, document?: Record<string, unknown>) => string[];
  collectNativeAssetCapabilityPathsFromSourceBin: (
    sourceBin: Record<string, unknown> | undefined,
  ) => string[];
  collectNativeAssetCapabilitiesFromSourceBin: (
    sourceBin: Record<string, unknown> | undefined,
  ) => Array<{ filePath: string; assetId?: string }>;
  deriveRestoredProjectPathFromBackupPath: (filePath: string) => string;
  collectSourceBinItems: (sourceBin: Record<string, unknown> | undefined) => Array<Record<string, unknown>>;
  createNativeAssetCapabilityRegistry: (initialPaths?: string[]) => {
    register: (filePath: string | undefined) => string | undefined;
    registerMany: (filePaths: Array<string | undefined>) => unknown;
    has: (filePath: string | undefined) => boolean;
    clear: () => void;
    list: () => string[];
    readonly size: number;
  };
  deriveProjectScratchDirectoryPath: (filePath: string) => string;
  ensureSignalLoomProjectExtension: (filePath: string) => string;
  extractRecoverableMediaSignatureFromSourceKey: (sourceKey: string | undefined) => string | undefined;
  getLinkedNativeSourcePath: (item: Record<string, unknown> | undefined) => string | undefined;
  getProjectSaveDialogDefaultPath: (filePath: string | undefined) => string;
  isSignalLoomProjectBackupPath: (filePath: string | undefined) => boolean;
  mapSourceBinItemsAsync: (
    sourceBin: Record<string, unknown> | undefined,
    mapItem: (item: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) => Promise<Record<string, unknown> | undefined>;
  parseProjectDocumentJson: (contents: string) => unknown;
  resolveScratchAssetNativePath: (
    item: Record<string, unknown>,
    scratchDirectoryPaths: string[],
    fileExists: (filePath: string) => boolean,
  ) => string | undefined;
  shouldWriteProjectSaveDirectly: (filePath: string | undefined) => boolean;
  sanitizeProjectDocument: (document: Record<string, unknown>) => Record<string, unknown>;
}

async function loadProjectFilesModule(): Promise<ElectronProjectFilesModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/project-files.cjs') as ElectronProjectFilesModule;
}

function nestedOutputMetadata(depth: number): Record<string, unknown> {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value };
  }
  return value as Record<string, unknown>;
}

const TOP_LEVEL_OUTPUT_METADATA_CASES: Array<[string, Record<string, unknown>, boolean]> = [
  ['exact string limit', { note: 'x'.repeat(16 * 1024) }, true],
  ['string one byte over', { note: 'x'.repeat(16 * 1024 + 1) }, false],
  ['exact object key limit', Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`key-${index}`, index])), true],
  ['object key one over', Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, index])), false],
  ['exact array limit', { values: Array.from({ length: 256 }, (_, index) => index) }, true],
  ['array one over', { values: Array.from({ length: 257 }, (_, index) => index) }, false],
  ['exact key byte limit', { ['k'.repeat(512)]: true }, true],
  ['key byte one over', { ['k'.repeat(513)]: true }, false],
  ['exact depth limit', nestedOutputMetadata(12), true],
  ['depth one over', nestedOutputMetadata(13), false],
  ['aggregate byte overflow', Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`entry-${index}`, 'x'.repeat(16 * 1024)])), false],
  ['node-count overflow', { values: Array.from({ length: 256 }, () => [0, 0, 0, 0]) }, false],
];

describe('Electron project file helpers', () => {
  it('keeps the Electron schema mirror aligned with the renderer schema', async () => {
    const projectFiles = await loadProjectFilesModule();

    expect(projectFiles.CURRENT_PROJECT_SCHEMA_VERSION).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(projectFiles.FLOW_NODE_TYPES).toEqual(FLOW_NODE_TYPES);
  });

  it('distinguishes linked native originals from project scratch assets', async () => {
    const projectFiles = await loadProjectFilesModule();

    expect(projectFiles.getLinkedNativeSourcePath({
      nativeFilePath: '/media/feature-film.mov',
    })).toBe('/media/feature-film.mov');
    expect(projectFiles.getLinkedNativeSourcePath({
      nativeFilePath: '/project/movie.sloom-scratch/clip.mov',
      scratchFileName: 'clip.mov',
    })).toBeUndefined();
    expect(projectFiles.getLinkedNativeSourcePath({
      nativeFilePath: '   ',
    })).toBeUndefined();
  });

  it.each([
    ['prototype keys from JSON', JSON.parse('{"safe":"value","__proto__":{"polluted":true}}')],
    ['nested constructor key', { safe: { constructor: { polluted: true } } }],
    ['nested prototype key', { safe: { prototype: { polluted: true } } }],
    ['enumerable throwing getter', (() => {
      const value: Record<string, unknown> = { safe: 'value' };
      Object.defineProperty(value, 'boom', { enumerable: true, get: () => { throw new Error('getter must not run'); } });
      return value;
    })()],
    ['throwing Proxy', new Proxy({ safe: 'value' }, { ownKeys: () => { throw new Error('proxy must not run'); } })],
  ])('fails closed for hostile metadata (%s) without losing selected Boolean attempt siblings', async (_description, outputMetadata) => {
    const { sanitizeProjectDocument: sanitizeElectronProjectDocument } = await loadProjectFilesModule();
    const raw = {
      id: 'hostile-metadata', name: 'Hostile metadata', savedAt: 1,
      flow: { version: 3, nodes: [{
        id: 'function', type: 'functionNode', position: { x: 0, y: 0 }, data: {
          selectedResultId: 'false-result', resultHistory: [{
            id: 'false-result', result: false, resultType: 'boolean', statusMessage: 'Completed', createdAt: '2026-07-16T00:00:00.000Z',
            mimeType: 'application/json', extension: 'json', fileName: 'decision.json', outputMetadata,
            variableName: 'is_safe', sourceBinItemId: 'boolean-source',
          }],
        },
      }], edges: [] },
    };
    const project = sanitizeElectronProjectDocument(raw);
    const renderer = sanitizeProjectDocument(raw);
    expect(project.flow).toEqual(renderer.flow);
    const data = ((project.flow as { nodes: Array<{ data: Record<string, unknown> }> }).nodes[0].data);

    expect(data).toMatchObject({
      selectedResultId: 'false-result', result: false, resultType: 'boolean', resultMimeType: 'application/json',
      resultExtension: 'json', resultFileName: 'decision.json',
    });
    expect((data.resultHistory as Array<Record<string, unknown>>)[0]).toMatchObject({
      result: false, variableName: 'is_safe', sourceBinItemId: 'boolean-source', outputMetadata: undefined,
    });
  });

  it('adds the Sloom Studio extension to save-as paths without one', async () => {
    const { ensureSignalLoomProjectExtension } = await loadProjectFilesModule();

    expect(ensureSignalLoomProjectExtension('/tmp/my-edit')).toBe('/tmp/my-edit.sloom');
  });

  it('uses the native Sloom Studio project extension for new saves', async () => {
    const { ensureSignalLoomProjectExtension } = await loadProjectFilesModule();

    expect(ensureSignalLoomProjectExtension('/tmp/project.sloom')).toBe('/tmp/project.sloom');
    expect(ensureSignalLoomProjectExtension('/tmp/project')).toBe('/tmp/project.sloom');
    expect(ensureSignalLoomProjectExtension('/tmp/project.json')).toBe('/tmp/project.json.sloom');
  });

  it('derives a sibling per-project scratch directory from .sloom project paths', async () => {
    const { deriveProjectScratchDirectoryPath } = await loadProjectFilesModule();

    expect(deriveProjectScratchDirectoryPath('/mnt/xtra/videos/my-cut.sloom'))
      .toBe('/mnt/xtra/videos/my-cut.signal-loom-scratch');
  });

  it('recognizes .sloom backup paths and derives a non-destructive restored project path', async () => {
    const {
      deriveRestoredProjectPathFromBackupPath,
      getProjectSaveDialogDefaultPath,
      isSignalLoomProjectBackupPath,
      shouldWriteProjectSaveDirectly,
    } = await loadProjectFilesModule();

    expect(isSignalLoomProjectBackupPath('/projects/Chronicle.sloom.bak-20260524001647-pre-lettering')).toBe(true);
    expect(isSignalLoomProjectBackupPath('/projects/Chronicle.sloom')).toBe(false);
    expect(shouldWriteProjectSaveDirectly('/projects/Chronicle.sloom.bak-20260524001647-pre-lettering')).toBe(false);
    expect(shouldWriteProjectSaveDirectly('/projects/Chronicle.sloom')).toBe(true);
    expect(deriveRestoredProjectPathFromBackupPath('/projects/Chronicle.sloom.bak-20260524001647-pre-lettering'))
      .toBe('/projects/Chronicle-restored-from-20260524001647-pre-lettering.sloom');
    expect(deriveRestoredProjectPathFromBackupPath('/projects/Chronicle.sloom.bak'))
      .toBe('/projects/Chronicle-restored.sloom');
    expect(getProjectSaveDialogDefaultPath('/projects/Chronicle.sloom.bak-20260524001647-pre-lettering'))
      .toBe('/projects/Chronicle-restored-from-20260524001647-pre-lettering.sloom');
    expect(getProjectSaveDialogDefaultPath('/projects/Chronicle.sloom')).toBe('/projects/Chronicle.sloom');
    expect(getProjectSaveDialogDefaultPath(undefined)).toBe('untitled.sloom');
  });

  it('builds timestamped sibling backups before project overwrites', async () => {
    const { buildProjectOverwriteBackupPath } = await loadProjectFilesModule();

    expect(buildProjectOverwriteBackupPath('/projects/Chronicle.sloom', new Date(2026, 4, 24, 17, 12, 3)))
      .toBe('/projects/Chronicle.sloom.bak-20260524171203');
    expect(buildProjectOverwriteBackupPath('/projects/Chronicle', new Date(2026, 4, 24, 17, 12, 3)))
      .toBe('/projects/Chronicle.sloom.bak-20260524171203');
  });

  it('includes legacy sibling scratch folders as fallback project asset locations', async () => {
    const { buildProjectScratchDirectoryCandidates } = await loadProjectFilesModule();

    expect(buildProjectScratchDirectoryCandidates('/mnt/xtra/videos/my-cut.sloom', {
      fileSystem: {
        scratchDirectoryName: 'scratch',
      },
    })).toEqual([
      '/mnt/xtra/videos/my-cut.signal-loom-scratch',
      '/mnt/xtra/videos/scratch',
    ]);
  });

  it('resolves missing renamed-project scratch assets from an existing legacy scratch folder', async () => {
    const { resolveScratchAssetNativePath } = await loadProjectFilesModule();

    expect(resolveScratchAssetNativePath(
      {
        scratchFileName: 'clip.mp4',
        nativeFilePath: '/mnt/xtra/videos/my-cut.signal-loom-scratch/clip.mp4',
      },
      [
        '/mnt/xtra/videos/my-cut.signal-loom-scratch',
        '/mnt/xtra/videos/scratch',
      ],
      (filePath) => filePath === '/mnt/xtra/videos/scratch/clip.mp4',
    )).toBe('/mnt/xtra/videos/scratch/clip.mp4');
  });

  it('adds the media extension to scratch filenames when model labels contain dots', async () => {
    const { buildNativeScratchFileName } = await loadProjectFilesModule();

    expect(buildNativeScratchFileName({
      id: 'video-1',
      label: 'veo-3.1-generate-preview',
      kind: 'video',
      mimeType: 'video/mp4',
    })).toBe('video-1-veo-3.1-generate-preview.mp4');

    expect(buildNativeScratchFileName({
      id: 'video-2',
      label: 'finished-cut.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
    })).toBe('video-2-finished-cut.mp4');
  });

  it('attaches native asset URLs to scratch-backed source-bin items on project open', async () => {
    const {
      attachNativeScratchAssetsToProjectDocument,
      buildNativeAssetUrl,
    } = await loadProjectFilesModule();

    const document = attachNativeScratchAssetsToProjectDocument({
      id: 'p1',
      name: 'Cut',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [],
        edges: [],
      },
      sourceBin: {
        dismissedSourceKeys: [],
        items: [
          {
            id: 'clip-1',
            label: 'clip.mp4',
            kind: 'video',
            mimeType: 'video/mp4',
            scratchFileName: 'clip.mp4',
            createdAt: 1,
          },
          {
            id: 'text-1',
            label: 'Title',
            kind: 'text',
            text: 'Hello',
            createdAt: 2,
          },
        ],
      },
    }, '/mnt/xtra/videos/my-cut.signal-loom-scratch');

    expect(document.sourceBin).toMatchObject({
      items: [
        {
          id: 'clip-1',
          nativeFilePath: '/mnt/xtra/videos/my-cut.signal-loom-scratch/clip.mp4',
          assetUrl: buildNativeAssetUrl('/mnt/xtra/videos/my-cut.signal-loom-scratch/clip.mp4', 'clip-1'),
        },
        {
          id: 'text-1',
        },
      ],
    });
    expect((document.sourceBin as { items: Array<Record<string, unknown>> }).items[1]).not.toHaveProperty('assetUrl');
    expect((document.sourceBin as { items: Array<Record<string, unknown>> }).items[1]).not.toHaveProperty('nativeFilePath');
  });

  it('builds opaque native asset URLs while preserving legacy file URL decoding', async () => {
    const {
      buildLegacyNativeAssetUrl,
      buildNativeAssetUrl,
      decodeNativeAssetUrl,
      parseNativeAssetUrl,
    } = await loadProjectFilesModule();
    const filePath = '/mnt/xtra/videos/my-cut.signal-loom-scratch/clip.mp4';
    const opaqueUrl = buildNativeAssetUrl(filePath, 'clip-1');
    const legacyUrl = buildLegacyNativeAssetUrl(filePath);

    expect(opaqueUrl).toBe('signal-loom-asset://asset/clip-1');
    expect(opaqueUrl).not.toContain(Buffer.from(filePath, 'utf8').toString('base64url'));
    expect(parseNativeAssetUrl(opaqueUrl)).toEqual({ type: 'asset', assetId: 'clip-1' });
    expect(parseNativeAssetUrl(legacyUrl)).toEqual({ type: 'file', filePath });
    expect(decodeNativeAssetUrl(legacyUrl)).toBe(filePath);
    expect(() => decodeNativeAssetUrl(opaqueUrl)).toThrow(/opaque/i);
  });

  it('attaches native asset URLs to binned source-library items on project open', async () => {
    const {
      attachNativeScratchAssetsToProjectDocument,
      buildNativeAssetUrl,
    } = await loadProjectFilesModule();

    const document = attachNativeScratchAssetsToProjectDocument({
      id: 'p1',
      name: 'Cut',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [],
        edges: [],
      },
      sourceBin: {
        dismissedSourceKeys: [],
        bins: [
          {
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [
              {
                id: 'video-1',
                label: 'generated-video.mp4',
                kind: 'video',
                mimeType: 'video/mp4',
                scratchFileName: 'generated-video.mp4',
                createdAt: 1,
              },
            ],
          },
        ],
      },
    }, '/mnt/xtra/videos/my-cut.signal-loom-scratch');

    expect(document.sourceBin).toMatchObject({
      bins: [
        {
          items: [
            {
              id: 'video-1',
              nativeFilePath: '/mnt/xtra/videos/my-cut.signal-loom-scratch/generated-video.mp4',
              assetUrl: buildNativeAssetUrl('/mnt/xtra/videos/my-cut.signal-loom-scratch/generated-video.mp4', 'video-1'),
            },
          ],
        },
      ],
    });
  });

  it('recovers missing Paper frame source-library items from project scratch assets during native open', async () => {
    const {
      attachNativeScratchAssetsToProjectDocument,
      buildNativeAssetUrl,
    } = await loadProjectFilesModule();
    const scratchDirectoryPath = mkdtempSync(join(tmpdir(), 'signal-loom-paper-recover-'));

    try {
      writeFileSync(join(scratchDirectoryPath, 'paper-missing-1-panel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const document = attachNativeScratchAssetsToProjectDocument({
        id: 'p1',
        name: 'Paper Recovery',
        savedAt: 1,
        flow: { version: 3, nodes: [], edges: [] },
        sourceBin: {
          dismissedSourceKeys: [],
          bins: [{
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [],
          }],
        },
        paper: {
          document: {
            id: 'paper-1',
            title: 'Paper Recovery',
            page: { preset: 'comic-book', widthMm: 170, heightMm: 260, bleedMm: 3.175, dpi: 300 },
            layout: {
              marginsMm: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
              columns: { count: 2, gutterMm: 5 },
              grid: { enabled: true, sizeMm: 5, subdivisions: 5 },
            },
            parentPages: [],
            styles: { paragraph: [], character: [], object: [] },
            pages: [{
              id: 'page-1',
              pageNumber: 1,
              guides: [],
              frames: [{
                id: 'frame-1',
                kind: 'image',
                label: 'Recovered panel',
                xMm: 0,
                yMm: 0,
                widthMm: 170,
                heightMm: 260,
                rotationDeg: 0,
                locked: false,
                fit: 'cover',
                imageScale: 1,
                imageOffsetXPercent: 0,
                imageOffsetYPercent: 0,
                imageRotationDeg: 0,
                imageFlipX: false,
                imageFlipY: false,
                columns: 1,
                typography: {
                  fontFamily: 'Inter',
                  fontSizePt: 10,
                  leadingPt: 13,
                  tracking: 0,
                  align: 'left',
                  hyphenate: true,
                  color: '#111827',
                  fontWeight: '400',
                  fontStyle: 'normal',
                },
                fillColor: 'transparent',
                fillOpacity: 1,
                strokeColor: '#111827',
                strokeOpacity: 1,
                strokeWidthMm: 0,
                strokeStyle: 'solid',
                cornerRadiusMm: 0,
                opacity: 1,
                textBoxXPercent: 0,
                textBoxYPercent: 0,
                textBoxWidthPercent: 100,
                textBoxHeightPercent: 100,
                textRotationDeg: 0,
                textVerticalAlign: 'top',
                zIndex: 0,
                inherited: false,
                asset: {
                  sourceBinItemId: 'paper-missing-1',
                  label: 'Recovered panel',
                  kind: 'image',
                  src: 'signal-loom-asset://asset/paper-missing-1',
                  mimeType: 'image/png',
                  pixelWidth: 896,
                  pixelHeight: 1200,
                },
              }],
            }],
            createdAt: 1,
            updatedAt: 1,
          },
          selectedPageId: 'page-1',
          selectedFrameId: 'frame-1',
          selectedFrameIds: ['frame-1'],
          tool: 'select',
          zoom: 0.8,
        },
      }, scratchDirectoryPath);

      expect(document.sourceBin).toMatchObject({
        bins: [
          {
            id: 'default',
            items: [
              expect.objectContaining({
                id: 'paper-missing-1',
                label: 'Recovered panel',
                mimeType: 'image/png',
                scratchFileName: 'paper-missing-1-panel.png',
                nativeFilePath: join(scratchDirectoryPath, 'paper-missing-1-panel.png'),
                assetUrl: buildNativeAssetUrl(join(scratchDirectoryPath, 'paper-missing-1-panel.png'), 'paper-missing-1'),
                pixelWidth: 896,
                pixelHeight: 1200,
              }),
            ],
          },
        ],
      });
    } finally {
      rmSync(scratchDirectoryPath, { recursive: true, force: true });
    }
  });

  it('collects registered native asset capability paths from source-library items', async () => {
    const {
      buildNativeAssetUrl,
      buildLegacyNativeAssetUrl,
      collectNativeAssetCapabilitiesFromSourceBin,
      collectNativeAssetCapabilityPathsFromSourceBin,
    } = await loadProjectFilesModule();

    expect(collectNativeAssetCapabilityPathsFromSourceBin({
      items: [
        {
          id: 'clip-1',
          kind: 'video',
          nativeFilePath: '/project/cut.signal-loom-scratch/clip.mp4',
          assetUrl: buildNativeAssetUrl('/project/cut.signal-loom-scratch/clip.mp4', 'clip-1'),
        },
        {
          id: 'image-1',
          kind: 'image',
          assetUrl: buildLegacyNativeAssetUrl('/project/cut.signal-loom-scratch/panel.png'),
        },
        {
          id: 'title',
          kind: 'text',
          text: 'Title',
        },
      ],
    })).toEqual([
      '/project/cut.signal-loom-scratch/clip.mp4',
      '/project/cut.signal-loom-scratch/panel.png',
    ]);
    expect(collectNativeAssetCapabilitiesFromSourceBin({
      items: [
        {
          id: 'clip-1',
          kind: 'video',
          nativeFilePath: '/project/cut.signal-loom-scratch/clip.mp4',
          assetUrl: buildNativeAssetUrl('/project/cut.signal-loom-scratch/clip.mp4', 'clip-1'),
        },
        {
          id: 'image-1',
          kind: 'image',
          assetUrl: buildLegacyNativeAssetUrl('/project/cut.signal-loom-scratch/panel.png'),
        },
      ],
    })).toEqual([
      { filePath: '/project/cut.signal-loom-scratch/clip.mp4', assetId: 'clip-1' },
      { filePath: '/project/cut.signal-loom-scratch/panel.png', assetId: 'image-1' },
    ]);
  });

  it('collects fallback scratch paths resolved during project open for capability registration', async () => {
    const {
      buildNativeAssetUrl,
      collectNativeAssetCapabilityPathsFromSourceBin,
    } = await loadProjectFilesModule();

    expect(collectNativeAssetCapabilityPathsFromSourceBin({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          items: [
            {
              id: 'legacy-clip',
              kind: 'video',
              nativeFilePath: '/project/legacy-scratch/clip.mp4',
              assetUrl: buildNativeAssetUrl('/project/legacy-scratch/clip.mp4', 'legacy-clip'),
              scratchFileName: 'clip.mp4',
            },
          ],
        },
      ],
    })).toEqual(['/project/legacy-scratch/clip.mp4']);
  });

  it('uses a native asset capability registry instead of allowing arbitrary decoded paths', async () => {
    const { createNativeAssetCapabilityRegistry } = await loadProjectFilesModule();
    const registry = createNativeAssetCapabilityRegistry(['/project/cut.signal-loom-scratch/clip.mp4']);

    expect(registry.has('/project/cut.signal-loom-scratch/clip.mp4')).toBe(true);
    expect(registry.has('/project/cut.signal-loom-scratch/../secrets.txt')).toBe(false);

    registry.register('/project/cut.signal-loom-scratch/panel.png');
    expect(registry.list()).toEqual([
      '/project/cut.signal-loom-scratch/clip.mp4',
      '/project/cut.signal-loom-scratch/panel.png',
    ]);
  });

  it('keeps unusable scratch assets from becoming previewable native asset URLs', async () => {
    const { attachNativeScratchAssetsToProjectDocument } = await loadProjectFilesModule();

    const document = attachNativeScratchAssetsToProjectDocument({
      id: 'p1',
      name: 'Cut',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [],
        edges: [],
      },
      sourceBin: {
        dismissedSourceKeys: [],
        items: [
          {
            id: 'image-1',
            label: 'empty.png',
            kind: 'image',
            mimeType: 'image/png',
            scratchFileName: 'empty.png',
            createdAt: 1,
          },
        ],
      },
    }, '/mnt/xtra/videos/my-cut.signal-loom-scratch', () => false);

    const [item] = (document.sourceBin as { items: Array<Record<string, unknown>> }).items;
    expect(item.nativeFilePath).toBe('/mnt/xtra/videos/my-cut.signal-loom-scratch/empty.png');
    expect(item.assetUrl).toBeUndefined();
  });

  it('rebuilds source-key media signatures from orphaned scratch asset bytes', async () => {
    const {
      buildDataUrlAssetSignatureCandidates,
      buildMediaAssetSignaturePart,
      extractRecoverableMediaSignatureFromSourceKey,
    } = await loadProjectFilesModule();
    const jpegBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(400, 7),
      Buffer.from([0xff, 0xd9]),
    ]);
    const jpegSignature = buildMediaAssetSignaturePart(`data:image/jpeg;base64,${jpegBuffer.toString('base64')}`);
    const pngExtensionSignature = buildMediaAssetSignaturePart(`data:image/png;base64,${jpegBuffer.toString('base64')}`);

    expect(extractRecoverableMediaSignatureFromSourceKey(`image:node-1:${jpegSignature}`)).toBe(jpegSignature);
    expect(buildDataUrlAssetSignatureCandidates(jpegBuffer, 'recovered-panel.png')).toEqual(
      expect.arrayContaining([jpegSignature, pngExtensionSignature]),
    );
  });

  it('maps and counts binned source-library media while preserving bin structure', async () => {
    const { collectSourceBinItems, mapSourceBinItemsAsync } = await loadProjectFilesModule();
    const sourceBin = {
      dismissedSourceKeys: [],
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            { id: 'image-1', label: 'still.png', kind: 'image', createdAt: 1 },
            { id: 'video-1', label: 'clip.mp4', kind: 'video', createdAt: 2 },
          ],
        },
      ],
    };

    const mapped = await mapSourceBinItemsAsync(sourceBin, async (item) => ({
      ...item,
      mapped: item.kind !== 'text',
    }));

    expect(collectSourceBinItems(mapped)).toEqual([
      expect.objectContaining({ id: 'image-1', mapped: true }),
      expect.objectContaining({ id: 'video-1', mapped: true }),
    ]);
    expect(mapped).toMatchObject({
      bins: [
        {
          id: 'default',
          items: [
            { id: 'image-1', mapped: true },
            { id: 'video-1', mapped: true },
          ],
        },
      ],
    });
  });

  it('parses a valid project document and rejects invalid files clearly', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    expect(parseProjectDocumentJson('{"id":"p1","name":"Cut","savedAt":1,"flow":{"version":3,"nodes":[],"edges":[]}}'))
      .toMatchObject({
        id: 'p1',
        name: 'Cut',
      });
    expect(parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Legacy',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [
          { id: 'good', type: 'textNode', position: null, data: { resultHistory: { bad: true } } },
          { id: 'bad', type: 'unknownNode', position: { x: 1, y: 2 }, data: {} },
        ],
        edges: [{ id: 'bad-edge', source: 'bad', target: 'good' }],
      },
    }))).toMatchObject({
      flow: {
        nodes: [{ id: 'good', position: { x: 0, y: 0 }, data: { resultHistory: [] } }],
        edges: [],
      },
    });
    expect(parseProjectDocumentJson(JSON.stringify({
      id: 'p2',
      name: 'Modern Flow',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [
          { id: 'portal-1', type: 'portal', position: { x: 1, y: 2 }, data: { portalRole: 'entry' } },
          { id: 'expander-1', type: 'expander', position: { x: 3, y: 4 }, data: { selectedItemId: 'asset-1' } },
        ],
        edges: [],
      },
    }))).toMatchObject({
      flow: {
        nodes: [
          { id: 'portal-1', type: 'portal' },
          { id: 'expander-1', type: 'expander' },
        ],
      },
    });
    expect(() => parseProjectDocumentJson('{"flow":{"nodes":{}}}')).toThrow(
      'not a valid Sloom Studio project',
    );
    expect(() => parseProjectDocumentJson('{')).toThrow('could not be parsed');
  });

  it('migrates legacy project documents without a top-level schema version', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    expect(parseProjectDocumentJson('{"id":"p1","name":"Legacy","savedAt":1,"flow":{"version":3,"nodes":[],"edges":[]}}'))
      .toMatchObject({ schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION });
  });

  it('migrates a legacy single-flow project into a main Flow workspace while parsing native documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    expect(parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Legacy Workspace',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'legacy-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
    }))).toMatchObject({
      activeFlowWorkspaceId: 'main',
      flowWorkspaces: [
        expect.objectContaining({
          id: 'main',
          name: 'Main Flow',
          flow: {
            version: 3,
            nodes: [expect.objectContaining({ id: 'legacy-node' })],
            edges: [],
          },
        }),
      ],
    });
  });

  it('hydrates the declared active Flow workspace while parsing native documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Native Multi Flow',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'stale-node', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
      activeFlowWorkspaceId: 'alt',
      flowWorkspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 10,
          updatedAt: 11,
          flow: {
            version: 3,
            nodes: [{ id: 'main-node', type: 'textNode', position: { x: 10, y: 20 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 20,
          updatedAt: 21,
          flow: {
            version: 3,
            nodes: [{ id: 'alt-node', type: 'textNode', position: { x: 30, y: 40 }, data: {} }],
            edges: [],
          },
        },
      ],
    })) as { flow?: { nodes?: Array<{ id?: string }> } };

    expect(parsed.flow?.nodes?.map((node) => node.id)).toEqual(['alt-node']);
  });

  it('preserves every current Flow node type while parsing project documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Current Nodes',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: FLOW_NODE_TYPES.map((type, index) => ({
          id: `${type}-${index}`,
          type,
          position: { x: index, y: index + 1 },
          data: {},
        })),
        edges: [],
      },
    })) as { flow?: { nodes?: Array<{ type?: string }> } };

    expect(parsed.flow?.nodes?.map((node) => node.type)).toEqual(FLOW_NODE_TYPES);
  });

  it('preserves renderer-valid result history types while parsing project documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const resultTypes = ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'];

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Result Types',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{
          id: 'result-node',
          type: 'textNode',
          position: { x: 0, y: 0 },
          data: {
            resultHistory: [
              ...resultTypes.map((resultType, index) => ({
                id: `attempt-${resultType}`,
                result: resultType === 'boolean' ? false : `result-${index}`,
                resultType,
                statusMessage: resultType,
                createdAt: '2026-01-01T00:00:00.000Z',
              })),
              {
                id: 'attempt-bad',
                result: 'bad',
                resultType: 'unknown',
                statusMessage: 'bad',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        }],
        edges: [],
      },
    })) as { flow?: { nodes?: Array<{ data?: { resultHistory?: Array<{ resultType?: string }> } }> } };

    expect(parsed.flow?.nodes?.[0].data?.resultHistory?.map((attempt) => attempt.resultType)).toEqual(resultTypes);
  });

  it('preserves real true and false histories and migrates only legacy Vision Verify text decisions', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1', name: 'Boolean restore', savedAt: 1,
      flow: {
        version: 3,
        nodes: [
          {
            id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 }, data: {
              selectedResultId: 'legacy-false',
              result: 'true', resultType: 'text',
              resultHistory: [
                { id: 'native-true', result: true, resultType: 'boolean', statusMessage: 'TRUE', createdAt: '2026-01-01T00:00:00.000Z' },
                { id: 'legacy-false', result: 'false', resultType: 'text', statusMessage: 'FALSE', createdAt: '2026-01-01T00:01:00.000Z' },
              ],
            },
          },
          {
            id: 'text', type: 'textNode', position: { x: 1, y: 0 }, data: {
              result: 'true', resultType: 'text',
              resultHistory: [{ id: 'text-true', result: 'true', resultType: 'text', statusMessage: 'Literal', createdAt: '2026-01-01T00:00:00.000Z' }],
            },
          },
        ],
        edges: [],
      },
    })) as { flow: { nodes: Array<{ id: string; data: Record<string, unknown> }> } };

    const verify = parsed.flow.nodes.find((node) => node.id === 'verify')!.data;
    expect(verify).toMatchObject({ result: false, resultType: 'boolean', selectedResultId: 'legacy-false' });
    expect(verify.resultHistory).toEqual([
      expect.objectContaining({ id: 'native-true', result: true, resultType: 'boolean' }),
      expect.objectContaining({ id: 'legacy-false', result: false, resultType: 'boolean' }),
    ]);
    expect(parsed.flow.nodes.find((node) => node.id === 'text')!.data).toMatchObject({ result: 'true', resultType: 'text' });
  });

  it('keeps Electron and app project sanitizers in parity for Boolean history migration', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const raw = {
      id: 'parity', name: 'Parity', savedAt: 1,
      flow: { version: 3, nodes: [{
        id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 },
        data: {
          selectedResultId: 'false',
          resultHistory: [
            { id: 'true', result: 'true', resultType: 'text', statusMessage: 'TRUE', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'false', result: 'false', resultType: 'text', statusMessage: 'FALSE', createdAt: '2026-01-01T00:01:00.000Z' },
          ],
        },
      }], edges: [] },
    };
    const renderer = sanitizeProjectDocument(raw);
    const electron = parseProjectDocumentJson(JSON.stringify(raw)) as typeof renderer;

    expect(electron.flow.nodes).toEqual(renderer.flow.nodes);
  });

  it('keeps Electron and browser Source Library hydration aligned without retyping Vision decisions', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const raw = {
      id: 'source-hydration', name: 'Source hydration', savedAt: 1,
      flow: {
        version: 3,
        nodes: [
          {
            id: 'verify-false', type: 'visionVerifyNode', position: { x: 0, y: 0 }, data: {
              selectedResultId: 'false', resultHistory: [
                { id: 'true', result: true, resultType: 'boolean', statusMessage: 'TRUE', createdAt: '2026-07-16T00:00:00.000Z' },
                { id: 'false', result: false, resultType: 'boolean', statusMessage: 'FALSE', createdAt: '2026-07-16T00:01:00.000Z', sourceBinItemId: 'stale-link' },
              ],
            },
          },
          {
            id: 'verify-true', type: 'visionVerifyNode', position: { x: 1, y: 0 }, data: {
              selectedResultId: 'true', resultHistory: [
                { id: 'false', result: false, resultType: 'boolean', statusMessage: 'FALSE', createdAt: '2026-07-16T00:00:00.000Z' },
                { id: 'true', result: true, resultType: 'boolean', statusMessage: 'TRUE', createdAt: '2026-07-16T00:01:00.000Z' },
              ],
            },
          },
          { id: 'image', type: 'imageGen', position: { x: 2, y: 0 }, data: {} },
          { id: 'text', type: 'textNode', position: { x: 3, y: 0 }, data: {} },
        ],
        edges: [],
      },
      sourceBin: {
        items: [
          { id: 'collision-false', kind: 'text', label: 'false', text: 'false', originNodeId: 'verify-false', createdAt: 1 },
          { id: 'collision-true', kind: 'text', label: 'true', text: 'true', originNodeId: 'verify-true', createdAt: 2 },
          { id: 'image-result', kind: 'image', label: 'Image', assetUrl: 'data:image/png;base64,IMAGE', originNodeId: 'image', createdAt: 3 },
          { id: 'text-result', kind: 'text', label: 'Text', text: 'do not hydrate', originNodeId: 'text', createdAt: 4 },
        ],
      },
    };
    const renderer = sanitizeProjectDocument(raw);
    const electron = parseProjectDocumentJson(JSON.stringify(raw)) as typeof renderer;

    expect(electron.flow.nodes).toEqual(renderer.flow.nodes);
    const byId = new Map(electron.flow.nodes.map((node) => [node.id, node.data]));
    expect(byId.get('verify-false')).toMatchObject({ selectedResultId: 'false', result: false, resultType: 'boolean' });
    expect(byId.get('verify-true')).toMatchObject({ selectedResultId: 'true', result: true, resultType: 'boolean' });
    expect(byId.get('image')).toMatchObject({ result: 'data:image/png;base64,IMAGE', resultType: 'image' });
    expect(byId.get('text')?.resultHistory).toBeUndefined();
  });

  it('matches Electron metadata bounds after JSON serialization', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const raw = {
      id: 'metadata-parity', name: 'Metadata parity', savedAt: 1,
      flow: {
        version: 3,
        nodes: [{
          id: 'image', type: 'imageGen', position: { x: 0, y: 0 }, data: {
            resultHistory: [
              { id: 'safe', result: 'data:image/png;base64,SAFE', resultType: 'image', statusMessage: 'safe', createdAt: '2026-07-16T00:00:00.000Z', outputMetadata: { note: 'x'.repeat(16 * 1024) } },
              { id: 'large', result: 'data:image/png;base64,LARGE', resultType: 'image', statusMessage: 'large', createdAt: '2026-07-16T00:01:00.000Z', outputMetadata: { note: 'x'.repeat(2 * 1024 * 1024) } },
              { id: 'wide', result: 'data:image/png;base64,WIDE', resultType: 'image', statusMessage: 'wide', createdAt: '2026-07-16T00:02:00.000Z', outputMetadata: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, index])) },
            ],
          },
        }],
        edges: [],
      },
    };
    const renderer = sanitizeProjectDocument(raw);
    const electron = parseProjectDocumentJson(JSON.stringify(raw)) as typeof renderer;

    expect(electron.flow.nodes).toEqual(renderer.flow.nodes);
    expect(electron.flow.nodes[0].data.resultHistory?.map((attempt) => attempt.outputMetadata)).toEqual([
      { note: 'x'.repeat(16 * 1024) }, undefined, undefined,
    ]);
  });

  it.each(TOP_LEVEL_OUTPUT_METADATA_CASES)(
    'applies matching top-level metadata bounds without history: %s',
    async (_description, resultOutputMetadata, preserved) => {
      const { parseProjectDocumentJson } = await loadProjectFilesModule();
      const raw = {
        id: 'top-level-metadata', name: 'Top level metadata', savedAt: 1,
        flow: {
          version: 3,
          nodes: [{
            id: 'function', type: 'functionNode', position: { x: 0, y: 0 },
            data: { result: 'false', resultType: 'boolean', resultOutputMetadata },
          }],
          edges: [],
        },
      };
      const renderer = sanitizeProjectDocument(raw);
      const electron = parseProjectDocumentJson(JSON.stringify(raw)) as typeof renderer;

      expect(electron.flow.nodes).toEqual(renderer.flow.nodes);
      const data = electron.flow.nodes[0].data;
      expect(data).toMatchObject({ result: false, resultType: 'boolean' });
      expect(data.resultOutputMetadata === undefined).toBe(!preserved);
      if (preserved) {
        expect(data.resultOutputMetadata).toEqual(resultOutputMetadata);
      }
    },
  );

  it('round-trips selected Boolean and media attempts with validated metadata, variables, and Source Bin linkage', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();
    const raw = {
      id: 'attempts', name: 'Attempt metadata', savedAt: 1,
      flow: { version: 3, nodes: [
        {
          id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 }, data: {
            selectedResultId: 'false',
            resultHistory: [{
              id: 'false', result: false, resultType: 'boolean', statusMessage: 'Verified: FALSE',
              createdAt: '2026-07-16T00:00:00.000Z', variableName: 'verified', sourceBinItemId: 'boolean-source',
              usage: { source: 'actual', confidence: 'measured', provider: 'gemini', totalTokens: 12, ignored: { unsafe: true } },
            }],
          },
        },
        {
          id: 'image', type: 'imageGen', position: { x: 1, y: 0 }, data: {
            selectedResultId: 'image-run',
            resultHistory: [{
              id: 'image-run', result: 'data:image/png;base64,ART', resultType: 'image', statusMessage: 'Generated',
              createdAt: '2026-07-16T00:01:00.000Z', variableName: 'hero_art', sourceBinItemId: 'source-image-1',
              mimeType: 'image/png', extension: 'png', fileName: 'hero.png',
              outputMetadata: { width: 1024, crop: { x: 0, y: 0 }, flags: [true, null] },
              usage: { source: 'actual', confidence: 'measured', provider: 'gemini', imageCount: 1 },
            }, {
              id: 'bad-metadata', result: 'data:image/png;base64,BAD', resultType: 'image', statusMessage: 'Bad metadata',
              createdAt: '2026-07-16T00:02:00.000Z', outputMetadata: 'not-an-object', variableName: 42,
            }],
          },
        },
      ], edges: [] },
    };
    const renderer = sanitizeProjectDocument(raw);
    const electron = parseProjectDocumentJson(JSON.stringify(raw)) as typeof renderer;

    expect(electron.flow.nodes).toEqual(renderer.flow.nodes);
    const verify = renderer.flow.nodes.find((node) => node.id === 'verify')!;
    const image = renderer.flow.nodes.find((node) => node.id === 'image')!;
    expect(verify.data).toMatchObject({ result: false, resultType: 'boolean', selectedResultId: 'false' });
    expect(image.data).toMatchObject({
      result: 'data:image/png;base64,ART', resultType: 'image', selectedResultId: 'image-run',
      resultMimeType: 'image/png', resultExtension: 'png', resultFileName: 'hero.png',
      resultOutputMetadata: { width: 1024, crop: { x: 0, y: 0 }, flags: [true, null] },
    });
    expect(image.data.resultHistory?.[0]).toMatchObject({ variableName: 'hero_art', sourceBinItemId: 'source-image-1' });
    expect(image.data.resultHistory?.[1]).toMatchObject({ outputMetadata: undefined, variableName: undefined });
    expect(image.data.resultHistory?.[0]?.usage).toEqual({
      source: 'actual', confidence: 'measured', provider: 'gemini', modelId: undefined,
      costUsd: undefined, inputTokens: undefined, outputTokens: undefined, totalTokens: undefined,
      characters: undefined, durationSeconds: undefined, imageCount: 1, notes: undefined,
    });

    expect(resolveFlowVariablesInText('{{verified}} / {{hero_art}}', renderer.flow.nodes, []).text)
      .toBe('false / data:image/png;base64,ART');
    expect(collectFlowVariableBindings(renderer.flow.nodes, []).map((binding) => binding.name))
      .toEqual(expect.arrayContaining(['verified', 'hero_art']));
    expect(resolveLiveNodeResultAssetUrl([
      { id: 'source-image-1', label: 'Hero art', kind: 'image', mimeType: 'image/png', createdAt: 1, assetUrl: 'data:image/png;base64,RESTORED' },
    ], {
      nodeId: image.id,
      enabled: true,
      resultSourceBinItemId: image.data.resultHistory?.[0]?.sourceBinItemId,
      servedSession: false,
    })).toBe('data:image/png;base64,RESTORED');
  });

  it('preserves Paper page-import envelopes and linked page frames while parsing native project documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Paper Drops',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: {
        dismissedSourceKeys: [],
        bins: [
          {
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [
              {
                id: 'paper-import-1',
                label: 'native-smoke-paper-page-2-os-drop.png',
                kind: 'image',
                mimeType: 'image/png',
                scratchFileName: 'paper-import-1.png',
                sourceKey: 'paper-page-import:paper-1:page-2:native-smoke-paper-page-2-os-drop.png:68:1710000000000',
                envelopeId: 'paper-page-imports:paper-1:page-2',
                envelopeLabel: 'Page 2 imports',
                envelopeIndex: 0,
                envelopeCollapsed: false,
                createdAt: 1,
              },
            ],
          },
        ],
      },
      paper: {
        document: {
          id: 'paper-1',
          title: 'Paper Drops',
          page: { preset: 'us-letter', widthMm: 215.9, heightMm: 279.4, bleedMm: 3, dpi: 300 },
          layout: {
            marginsMm: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
            columns: { count: 2, gutterMm: 5 },
            grid: { enabled: true, sizeMm: 5, subdivisions: 5 },
          },
          pages: [
            { id: 'page-1', pageNumber: 1, frames: [], guides: [] },
            {
              id: 'page-2',
              pageNumber: 2,
              guides: [],
              frames: [
                {
                  id: 'frame-1',
                  kind: 'image',
                  label: 'native-smoke-paper-page-2-os-drop.png',
                  xMm: 10,
                  yMm: 12,
                  widthMm: 40,
                  heightMm: 30,
                  rotationDeg: 0,
                  locked: false,
                  fit: 'cover',
                  imageScale: 100,
                  imageOffsetXPercent: 0,
                  imageOffsetYPercent: 0,
                  imageRotationDeg: 0,
                  columns: 1,
                  typography: {
                    fontFamily: 'Inter',
                    fontSizePt: 10,
                    leadingPt: 13,
                    tracking: 0,
                    align: 'left',
                    hyphenate: true,
                    color: '#111827',
                    fontWeight: '400',
                    fontStyle: 'normal',
                  },
                  fillColor: 'transparent',
                  fillOpacity: 1,
                  strokeColor: '#111827',
                  strokeOpacity: 1,
                  strokeWidthMm: 0,
                  strokeStyle: 'solid',
                  cornerRadiusMm: 0,
                  opacity: 1,
                  textBoxXPercent: 0,
                  textBoxYPercent: 0,
                  textBoxWidthPercent: 100,
                  textBoxHeightPercent: 100,
                  textRotationDeg: 0,
                  zIndex: 0,
                  asset: {
                    sourceBinItemId: 'paper-import-1',
                    label: 'native-smoke-paper-page-2-os-drop.png',
                    kind: 'image',
                    src: 'signal-loom-asset://asset/paper-import-1',
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
        selectedPageId: 'page-2',
        selectedFrameId: 'frame-1',
        selectedFrameIds: ['frame-1'],
        tool: 'select',
        zoom: 0.8,
      },
    })) as {
      sourceBin?: { bins?: Array<{ items?: Array<Record<string, unknown>> }> };
      paper?: { document?: { pages?: Array<{ pageNumber?: number; frames?: Array<{ asset?: Record<string, unknown> }> }> } };
    };

    const [sourceItem] = parsed.sourceBin?.bins?.[0].items ?? [];
    const pageTwoFrame = parsed.paper?.document?.pages
      ?.find((page) => page.pageNumber === 2)
      ?.frames?.[0];

    expect(sourceItem).toMatchObject({
      id: 'paper-import-1',
      envelopeId: 'paper-page-imports:paper-1:page-2',
      envelopeLabel: 'Page 2 imports',
      envelopeIndex: 0,
    });
    expect(pageTwoFrame?.asset).toMatchObject({
      sourceBinItemId: 'paper-import-1',
      label: 'native-smoke-paper-page-2-os-drop.png',
      mimeType: 'image/png',
    });
  });

  it('drops transient recovered scratch assets when parsing saved project documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Recovered Scratch Pollution',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: {
        dismissedSourceKeys: [],
        bins: [
          {
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [
              {
                id: 'panel-1',
                label: 'Panel 1',
                kind: 'image',
                mimeType: 'image/png',
                scratchFileName: 'panel-1.png',
                createdAt: 1,
              },
              {
                id: 'recovered-inline',
                label: 'Orphan scratch file',
                kind: 'image',
                mimeType: 'image/png',
                scratchFileName: 'orphan-inline.png',
                sourceKey: 'recovered-scratch:orphan-inline.png',
                createdAt: 2,
              },
            ],
          },
          {
            id: 'recovered-scratch-assets',
            name: 'Recovered Scratch Assets',
            collapsed: true,
            createdAt: 3,
            items: [
              {
                id: 'recovered-orphan',
                label: 'Orphan scratch file',
                kind: 'image',
                mimeType: 'image/png',
                scratchFileName: 'orphan.png',
                sourceKey: 'recovered-scratch:orphan.png',
                createdAt: 3,
              },
            ],
          },
        ],
      },
    })) as { sourceBin?: { bins?: Array<{ id: string; items: Array<Record<string, unknown>> }> } };

    expect(parsed.sourceBin?.bins?.map((bin) => bin.id)).toEqual(['default']);
    expect(parsed.sourceBin?.bins?.[0].items.map((item) => item.id)).toEqual(['panel-1']);
  });

  it('sanitizes project usage ledgers when parsing saved project documents', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Spend Ledger',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      usageLedger: {
        version: 'bad',
        entries: [
          {
            id: 'usage-1',
            createdAt: 10,
            workspace: 'paper',
            operation: 'print-upscale',
            provider: 'stability',
            modelId: 'stable-image-upscale-fast',
            source: 'actual',
            confidence: 'fixed',
            costUsd: 0.02,
          },
          { id: 'bad', source: 'nonsense', confidence: 'fixed' },
        ],
      },
    })) as { usageLedger?: { version?: number; entries?: Array<Record<string, unknown>> } };

    expect(parsed.usageLedger).toMatchObject({
      version: 1,
      entries: [expect.objectContaining({ id: 'usage-1', workspace: 'paper', costUsd: 0.02 })],
    });
  });

  it('preserves every current Flow node type in Electron project usage ledgers', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Spend Ledger Node Types',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      usageLedger: {
        version: 1,
        entries: [
          ...FLOW_NODE_TYPES.map((nodeType, index) => ({
            id: `usage-${nodeType}`,
            createdAt: index,
            workspace: 'flow',
            operation: `operation-${nodeType}`,
            nodeType,
            source: 'actual',
            confidence: 'measured',
          })),
          {
            id: 'unknown-node-type',
            createdAt: 999,
            workspace: 'flow',
            operation: 'unknown-operation',
            nodeType: 'mysteryNode',
            source: 'actual',
            confidence: 'measured',
          },
        ],
      },
    })) as { usageLedger?: { entries?: Array<Record<string, unknown>> } };

    const entries = parsed.usageLedger?.entries ?? [];
    expect(entries.map((entry) => entry.nodeType)).toEqual([...FLOW_NODE_TYPES, undefined]);
    expect(entries.at(-1)).toHaveProperty('nodeType', undefined);
  });

  it('preserves Flow workspace ids and names in Electron project usage ledgers', async () => {
    const { parseProjectDocumentJson } = await loadProjectFilesModule();

    const parsed = parseProjectDocumentJson(JSON.stringify({
      id: 'p1',
      name: 'Spend Ledger Flow Workspaces',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      usageLedger: {
        version: 1,
        entries: [{
          id: 'usage-flow-workspace',
          createdAt: 100,
          workspace: 'flow',
          flowWorkspaceId: 'workspace-a',
          flowWorkspaceName: 'Issue 1',
          operation: 'mask-inpaint',
          nodeType: 'imageGen',
          source: 'actual',
          confidence: 'measured',
        }],
      },
    })) as { usageLedger?: { entries?: Array<Record<string, unknown>> } };

    expect(parsed.usageLedger?.entries?.[0]).toMatchObject({
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
    });
  });
});
