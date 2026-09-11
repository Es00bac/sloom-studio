import { describe, expect, it } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { addPaperPage, createDefaultPaperDocument } from './paperDocument';
import {
  buildPaperPageImageImportPlan,
  filterPaperPageImageImportFiles,
  hasPaperPageImageFileDrag,
  type PaperPageImportFileLike,
} from './paperPageDropImports';

function file(overrides: Partial<PaperPageImportFileLike> & { name: string }): PaperPageImportFileLike {
  return {
    name: overrides.name,
    type: overrides.type ?? '',
    size: overrides.size ?? 1024,
    lastModified: overrides.lastModified ?? 1234,
  };
}

function sourceItem(overrides: Partial<SourceBinLibraryItem>): SourceBinLibraryItem {
  return {
    id: overrides.id ?? 'source-1',
    label: overrides.label ?? 'Existing',
    kind: overrides.kind ?? 'image',
    mimeType: overrides.mimeType ?? 'image/png',
    assetUrl: overrides.assetUrl ?? 'data:image/png;base64,abc123',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

describe('paperPageDropImports', () => {
  it('filters OS drop files to importable images while accepting extension-only file-manager payloads', () => {
    const files = [
      file({ name: 'cover.png', type: 'image/png' }),
      file({ name: 'scan.SVG' }),
      file({ name: 'reference.pdf', type: 'application/pdf' }),
      file({ name: 'clip.mp4', type: 'video/mp4' }),
      file({ name: 'notes' }),
    ];

    expect(filterPaperPageImageImportFiles(files).map((candidate) => candidate.name)).toEqual([
      'cover.png',
      'scan.SVG',
    ]);
  });

  it('recognizes OS file drags without confusing Source Library item drags for imports', () => {
    expect(hasPaperPageImageFileDrag({
      types: ['Files'],
      files: [],
    })).toBe(true);
    expect(hasPaperPageImageFileDrag({
      types: ['application/x-flow-source-bin-item'],
      files: [file({ name: 'cover.png', type: 'image/png' })],
    })).toBe(false);
    expect(hasPaperPageImageFileDrag({
      types: ['Files'],
      files: [file({ name: 'reference.pdf', type: 'application/pdf' })],
    })).toBe(false);
  });

  it('builds stable Page N imports envelope metadata and appends after existing imports', () => {
    let document = createDefaultPaperDocument({ title: 'Storyboard' });
    document = addPaperPage(document);
    const page = document.pages[1];
    const envelopeId = `paper-page-imports:${document.id}:${page.id}`;

    const plan = buildPaperPageImageImportPlan({
      document,
      pageId: page.id,
      files: [
        file({ name: 'pose.png', type: 'image/png', size: 2048, lastModified: 400 }),
        file({ name: 'background.webp', type: 'image/webp', size: 4096, lastModified: 500 }),
      ],
      existingItems: [
        sourceItem({ id: 'other', envelopeId: 'paper-page-imports:other:page', envelopeIndex: 99 }),
        sourceItem({ id: 'old-0', envelopeId, envelopeIndex: 0 }),
        sourceItem({ id: 'old-2', envelopeId, envelopeIndex: 2 }),
      ],
      point: { xMm: 12, yMm: 34 },
    });

    expect(plan).toMatchObject({
      pageId: page.id,
      pageNumber: 2,
      envelopeId,
      envelopeLabel: 'Page 2 imports',
    });
    expect(plan.items.map((item) => ({
      label: item.label,
      kind: item.kind,
      mimeType: item.mimeType,
      sourceKey: item.sourceKey,
      envelopeIndex: item.envelopeIndex,
      placementPoint: item.placementPoint,
    }))).toEqual([
      {
        label: 'pose.png',
        kind: 'image',
        mimeType: 'image/png',
        sourceKey: `paper-page-import:${document.id}:${page.id}:pose.png:2048:400`,
        envelopeIndex: 3,
        placementPoint: { xMm: 12, yMm: 34 },
      },
      {
        label: 'background.webp',
        kind: 'image',
        mimeType: 'image/webp',
        sourceKey: `paper-page-import:${document.id}:${page.id}:background.webp:4096:500`,
        envelopeIndex: 4,
        placementPoint: { xMm: 16, yMm: 38 },
      },
    ]);
  });
});
