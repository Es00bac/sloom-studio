import { describe, expect, it } from 'vitest';
import type { FlowProjectDocument } from './projectLibrary';
import type { PaperFrameAsset } from '../types/paper';
import {
  normalizeProjectMediaReferencesForSave,
  resolveProjectMediaReferencesForRestore,
} from './projectMediaReferences';
import { createDefaultPaperDocument } from './paperDocument';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';

const imageDataUrl = 'data:image/png;base64,AAAABBBBCCCC';
const signalAssetUrl = 'signal-loom-asset://file/panel-one';

function buildProjectDocument(): FlowProjectDocument {
  const paperDocument = createDefaultPaperDocument({ title: 'Paper', preset: 'a4' });

  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: 'project-1',
    name: 'Project',
    savedAt: 1,
    flow: {
      version: 3,
      nodes: [
        {
          id: 'image-envelope',
          type: 'envelope',
          position: { x: 0, y: 0 },
          data: {
            envelopeItems: [
              {
                id: 'image-envelope-item-0',
                index: 0,
                kind: 'image',
                label: 'Image 1',
                value: imageDataUrl,
                mimeType: 'image/png',
              },
            ],
          },
        },
      ],
      edges: [],
    },
    sourceBin: {
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'source-image-1',
              label: 'Image 1',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: signalAssetUrl,
              createdAt: 1,
              sourceKey: 'image:image-envelope:0:data:image/png;base64,AAAABBBBCCCC',
              originNodeId: 'image-envelope:0',
              envelopeId: 'image-envelope',
              envelopeIndex: 0,
            },
          ],
        },
      ],
      dismissedSourceKeys: [],
    },
    paper: {
      document: {
        ...paperDocument,
        id: 'paper-1',
        parentPages: [],
        pages: [
          {
            id: 'page-1',
            pageNumber: 1,
            guides: [],
            frames: [
              {
                id: 'frame-1',
                kind: 'image',
                label: 'Frame 1',
                xMm: 0,
                yMm: 0,
                widthMm: 100,
                heightMm: 50,
                rotationDeg: 0,
                locked: false,
                asset: {
                  sourceBinItemId: 'source-image-1',
                  label: 'Image 1',
                  kind: 'image',
                  src: imageDataUrl,
                  mimeType: 'image/png',
                } as unknown as PaperFrameAsset,
                fit: 'cover',
                imageScale: 1,
                imageOffsetXPercent: 0,
                imageOffsetYPercent: 0,
                imageRotationDeg: 0,
                columns: 1,
                typography: {
                  fontFamily: 'Inter',
                  fontSizePt: 12,
                  leadingPt: 14,
                  tracking: 0,
                  align: 'left',
                  hyphenate: false,
                  color: '#000000',
                  fontWeight: '400',
                  fontStyle: 'normal',
                },
                fillColor: 'transparent',
                fillOpacity: 1,
                strokeColor: '#000000',
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
                zIndex: 1,
              },
            ],
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      selectedPageId: 'page-1',
      tool: 'select',
      zoom: 1,
    },
  };
}

describe('project media reference normalization', () => {
  it('normalizes media in every open Paper document tab', () => {
    const project = buildProjectDocument();
    const english = project.paper!.document!;
    const japanese = {
      ...english,
      id: 'paper-ja',
      title: '日本語版',
      pages: english.pages.map((page) => ({
        ...page,
        id: `${page.id}-ja`,
        frames: page.frames.map((frame) => ({
          ...frame,
          id: `${frame.id}-ja`,
          asset: frame.asset ? { ...frame.asset } : undefined,
        })),
      })),
    };
    project.paper = {
      ...project.paper,
      document: japanese,
      documents: [
        { id: 'tab-en', document: english, tool: 'select', zoom: 1 },
        { id: 'tab-ja', document: japanese, tool: 'select', zoom: 1 },
      ],
      activeDocumentId: 'tab-ja',
    };

    const result = normalizeProjectMediaReferencesForSave(project);

    expect(result.document.paper?.documents?.every((workspaceDocument) =>
      workspaceDocument.document.pages[0]?.frames[0]?.asset?.locator?.kind === 'external')).toBe(true);
    expect(result.document.paper?.document?.title).toBe('日本語版');
    expect(result.stats.paperEmbeddedMediaReplaced).toBe(2);
  });

  it('replaces Paper and Flow embedded media with Source Library references for save', () => {
    const result = normalizeProjectMediaReferencesForSave(buildProjectDocument());
    const frameAsset = result.document.paper!.document!.pages[0]!.frames[0]!.asset;
    const envelopeItem = result.document.flow.nodes[0]!.data.envelopeItems?.[0];

    expect(frameAsset?.locator).toEqual({ kind: 'external', url: signalAssetUrl });
    expect(envelopeItem?.value).toBe(signalAssetUrl);
    expect(envelopeItem?.sourceBinItemId).toBe('source-image-1');
    expect(JSON.stringify(result.document.flow)).not.toContain(imageDataUrl);
    expect(JSON.stringify(result.document.paper)).not.toContain(imageDataUrl);
    expect(result.stats.paperEmbeddedMediaReplaced).toBe(1);
    expect(result.stats.flowEmbeddedMediaReplaced).toBe(1);
  });

  it('normalizes legacy parent-page assets through the same Source Library link', () => {
    const project = buildProjectDocument();
    const parentFrame = {
      ...project.paper!.document!.pages[0]!.frames[0]!,
      id: 'parent-frame-1',
    };
    project.paper!.document!.parentPages = [{
      id: 'parent-page-1',
      name: 'A-Parent',
      guides: [],
      frames: [parentFrame],
    }];

    const result = normalizeProjectMediaReferencesForSave(project);
    const parentAsset = result.document.paper!.document!.parentPages[0]!.frames[0]!.asset;

    expect(parentAsset?.locator).toEqual({ kind: 'external', url: signalAssetUrl });
    expect(JSON.stringify(result.document.paper)).not.toContain(imageDataUrl);
    expect(result.stats.paperEmbeddedMediaReplaced).toBe(2);
  });

  it('rehydrates lightweight Paper and Flow references from restored Source Library items', () => {
    const saved = normalizeProjectMediaReferencesForSave(buildProjectDocument()).document;
    const sourceItems = saved.sourceBin?.bins?.flatMap((bin) => bin.items) ?? [];
    const restored = resolveProjectMediaReferencesForRestore(saved, sourceItems);

    expect(restored.paper!.document!.pages[0]!.frames[0]!.asset?.locator).toEqual({ kind: 'external', url: signalAssetUrl });
    expect(restored.flow.nodes[0]!.data.envelopeItems?.[0]?.value).toBe(signalAssetUrl);
    expect(restored.flow.nodes[0]!.data.envelopeItems?.[0]?.sourceBinItemId).toBe('source-image-1');
  });

  it('repairs duplicate envelope source ids by matching each durable media value to its source item', () => {
    const project = buildProjectDocument();
    project.flow.nodes[0]!.data.envelopeItems = [
      {
        id: 'image-envelope-item-0',
        index: 0,
        kind: 'image',
        label: 'Image 1',
        value: 'signal-loom-asset://file/panel-one',
        mimeType: 'image/png',
        sourceBinItemId: 'source-image-1',
      },
      {
        id: 'image-envelope-item-1',
        index: 1,
        kind: 'image',
        label: 'Image 2',
        value: 'signal-loom-asset://file/panel-two',
        mimeType: 'image/png',
        sourceBinItemId: 'source-image-1',
      },
    ];
    project.sourceBin!.bins![0]!.items = [
      {
        id: 'source-image-1',
        label: 'Image 1',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'signal-loom-asset://file/panel-one',
        createdAt: 1,
        sourceKey: 'image:image-envelope:0:signal-loom-asset://file/panel-one',
        originNodeId: 'image-envelope:0',
        envelopeId: 'image-envelope',
        envelopeIndex: 0,
      },
      {
        id: 'source-image-2',
        label: 'Image 2',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'signal-loom-asset://file/panel-two',
        createdAt: 2,
        sourceKey: 'image:image-envelope:0:signal-loom-asset://file/panel-two',
        originNodeId: 'image-envelope:0',
        envelopeId: 'image-envelope',
        envelopeIndex: 0,
      },
    ];

    const result = normalizeProjectMediaReferencesForSave(project);
    const envelopeItems = result.document.flow.nodes[0]!.data.envelopeItems;

    expect(envelopeItems?.map((item) => item.sourceBinItemId)).toEqual([
      'source-image-1',
      'source-image-2',
    ]);
  });

  it('normalizes inactive Flow workspace snapshots alongside the active flow snapshot', () => {
    const project = buildProjectDocument();
    project.activeFlowWorkspaceId = 'main';
    project.flowWorkspaces = [
      {
        id: 'main',
        name: 'Main Flow',
        createdAt: 1,
        updatedAt: 2,
        flow: project.flow,
      },
      {
        id: 'alt',
        name: 'Alt Flow',
        createdAt: 3,
        updatedAt: 4,
        flow: {
          version: 3,
          nodes: [
            {
              id: 'alt-envelope',
              type: 'envelope',
              position: { x: 10, y: 20 },
              data: {
                envelopeItems: [
                  {
                    id: 'alt-envelope-item-0',
                    index: 0,
                    kind: 'image',
                    label: 'Image 1',
                    value: imageDataUrl,
                    mimeType: 'image/png',
                  },
                ],
              },
            },
          ],
          edges: [],
        },
      },
    ];
    project.sourceBin!.bins![0]!.items[0]!.sourceKey = 'image:alt-envelope:0:data:image/png;base64,AAAABBBBCCCC';
    project.sourceBin!.bins![0]!.items[0]!.originNodeId = 'alt-envelope:0';
    project.sourceBin!.bins![0]!.items[0]!.envelopeId = 'alt-envelope';

    const result = normalizeProjectMediaReferencesForSave(project);
    const inactiveEnvelopeItem = result.document.flowWorkspaces
      ?.find((workspace) => workspace.id === 'alt')
      ?.flow.nodes[0]
      ?.data.envelopeItems?.[0];

    expect(inactiveEnvelopeItem?.value).toBe(signalAssetUrl);
    expect(inactiveEnvelopeItem?.sourceBinItemId).toBe('source-image-1');
  });

  it('recomputes captured Paper asset inventories atomically with save-time locator remapping', () => {
    const managedSha = 'c'.repeat(64);
    const managedAssetId = `sha256:${managedSha}` as const;
    const project = buildProjectDocument();
    const paperDocument = project.paper!.document!;
    paperDocument.pages[0]!.frames[0]!.asset = {
      sourceBinItemId: 'source-image-1',
      label: 'Image 1',
      kind: 'image',
      mimeType: 'image/png',
      locator: {
        kind: 'managed',
        ref: { id: managedAssetId, sha256: managedSha, mimeType: 'image/png', byteLength: 3 },
      },
    } as PaperFrameAsset;
    project.paper = {
      ...project.paper!,
      assetIds: [managedAssetId],
      documents: [{ id: 'tab-1', document: paperDocument, assetIds: [managedAssetId], tool: 'select', zoom: 1 }],
      activeDocumentId: 'tab-1',
    };

    const result = normalizeProjectMediaReferencesForSave(project);
    const savedPaper = result.document.paper!;

    // The managed locator is remapped to the durable Source Library URL...
    expect(savedPaper.document!.pages[0]!.frames[0]!.asset?.locator).toEqual({ kind: 'external', url: signalAssetUrl });
    // ...so the captured inventories must be rewritten with the same remap, or the
    // reopened project fails validation and Paper silently restores a blank workspace.
    expect(savedPaper.documents?.[0]?.assetIds).toEqual([]);
    expect(savedPaper.assetIds).toEqual([]);
  });
});
