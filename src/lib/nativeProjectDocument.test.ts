import { describe, expect, it, vi } from 'vitest';
import { buildNativeSaveProjectDocument } from './nativeProjectDocument';
import { buildCurrentProjectDocument } from './projectDocumentActions';

vi.mock('./projectDocumentActions', () => ({
  buildCurrentProjectDocument: vi.fn(async (options) => ({
    id: 'project-1',
    name: options?.name ?? 'Project',
    savedAt: 1,
    flow: { nodes: [], edges: [] },
    editor: undefined,
    sourceBin: { dismissedSourceKeys: [] },
  })),
}));

describe('buildNativeSaveProjectDocument', () => {
  it('embeds temporary renderer asset data before native Electron saves the project', async () => {
    await buildNativeSaveProjectDocument('Cut 02');

    expect(buildCurrentProjectDocument).toHaveBeenCalledWith({
      name: 'Cut 02',
      includeAssetData: true,
    });
  });
});
